import { serve, SQL } from "bun";
import { readFileSync } from "fs";
import path from "path";

const sql = new SQL(process.env.POSTGRES_URL!);

// Ensures the 'todos' table exists in the database.
async function ensureTableExists() {
    try {
        await sql`SELECT 1 FROM todos LIMIT 1;`;
    } catch (error: any) {
        if (error?.code === '42P01' || error?.message?.includes('relation "todos" does not exist')) {
            try {
                await sql`
                    CREATE TABLE todos (
                        id SERIAL PRIMARY KEY,
                        task TEXT NOT NULL,
                        completed BOOLEAN DEFAULT FALSE
                    );
                `;
            } catch (creationError) {
                console.error("Failed to create 'todos' table:", creationError);
                process.exit(1);
            }
        } else {
            console.error("Error checking/creating 'todos' table:", error);
            process.exit(1);
        }
    }
}

const htmlPath = path.join(import.meta.dir, "index.html");
const cssPath = path.join(import.meta.dir, "style.css");

// Serves a file with the specified content type.
function serveFile(filePath: string, contentType: string): Response {
    try {
        const fileContent = readFileSync(filePath);
        return new Response(fileContent, {
            headers: { "Content-Type": contentType },
        });
    } catch (e) {
        console.error(`Error reading file ${filePath}:`, e);
        return new Response("Not Found", { status: 404 });
    }
}

// Fetches all todos from the database.
async function getTodos(): Promise<Response> {
    try {
        const todos = await sql`SELECT * FROM todos ORDER BY id ASC`;
        return Response.json(todos);
    } catch (error) {
        console.error("Error fetching todos:", error);
        return new Response("Failed to fetch todos", { status: 500 });
    }
}

// Adds a new todo to the database.
async function addTodo(request: Request): Promise<Response> {
    try {
        const { task } = (await request.json()) as { task?: string };
        if (!task || typeof task !== 'string' || task.trim() === '') {
            return new Response("Invalid task provided", { status: 400 });
        }
        const [newTodo] = await sql`INSERT INTO todos (task) VALUES (${task.trim()}) RETURNING *`;
        return Response.json(newTodo, { status: 201 });
    } catch (error) {
        console.error("Error adding todo:", error);
        return new Response("Failed to add todo", { status: 500 });
    }
}

// Deletes a todo from the database by its ID.
async function deleteTodo(id: string): Promise<Response> {
    const todoId = parseInt(id, 10);
    if (isNaN(todoId)) {
        return new Response("Invalid ID format", { status: 400 });
    }
    try {
        await sql`DELETE FROM todos WHERE id = ${todoId}`;
        return new Response(null, { status: 204 });
    } catch (error) {
        console.error(`Error deleting todo with id ${todoId}:`, error);
        return new Response("Failed to delete todo", { status: 500 });
    }
}

// Toggles the completion status of a todo in the database.
async function toggleTodo(id: string): Promise<Response> {
    const todoId = parseInt(id, 10);
    if (isNaN(todoId)) {
        return new Response("Invalid ID format", { status: 400 });
    }
    try {
        const [updatedTodo] = await sql`
            UPDATE todos
            SET completed = NOT completed
            WHERE id = ${todoId}
            RETURNING *
        `;

        if (!updatedTodo) {
            return new Response("Todo not found", { status: 404 });
        }
        return Response.json(updatedTodo);
    } catch (error) {
        console.error(`Error toggling todo with id ${todoId}:`, error);
        return new Response("Failed to toggle todo", { status: 500 });
    }
}

const PORT = process.env.PORT || 3000;

console.log("Starting server setup...");

await ensureTableExists();

console.log(`Server starting on http://localhost:${PORT}`);

// Configures and starts the Bun server.
serve({
    port: Number(PORT),
    async fetch(request) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        console.log(`${method} ${path}`);

        if (method === "GET" && path === "/") {
            return serveFile(htmlPath, "text/html; charset=utf-8");
        }
        if (method === "GET" && path === "/style.css") {
            return serveFile(cssPath, "text/css; charset=utf-8");
        }

        if (path === "/api/todos") {
            if (method === "GET") {
                return getTodos();
            }
            if (method === "POST") {
                return addTodo(request);
            }
        }

        const todoIdMatch = path.match(/^\/api\/todos\/(\d+)$/);
        const toggleMatch = path.match(/^\/api\/todos\/(\d+)\/toggle$/);

        if (method === "DELETE" && todoIdMatch) {
            const id = todoIdMatch[1];
            if (id) {
                return deleteTodo(id);
            }
        }

        if (method === "PATCH" && toggleMatch) {
            const id = toggleMatch[1];
            if (id) {
                return toggleTodo(id);
            }
        }

        return new Response("Not Found", { status: 404 });
    },
    error(error: Error) {
        console.error("Server error:", error);
        return new Response("Internal Server Error", { status: 500 });
    },
});