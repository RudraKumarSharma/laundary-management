import http from "node:http";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, "dist");
const publicDir = path.join(__dirname, "public");
const statusValues = ["RECEIVED", "PROCESSING", "READY", "DELIVERED"];

// MongoDB connection
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/laundry-management";
let client = null;
let ordersCollection = null;

async function connectDatabase() {
  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db();
    ordersCollection = db.collection("orders");

    // Create indexes for better performance
    await ordersCollection.createIndex({ created_at: -1 });
    await ordersCollection.createIndex({ status: 1 });

    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error.message);
    process.exit(1);
  }
}

async function getStaticRoot() {
  try {
    await access(distDir);
    return distDir;
  } catch {
    return publicDir;
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function sendText(
  res,
  statusCode,
  text,
  contentType = "text/plain; charset=utf-8",
) {
  res.writeHead(statusCode, { "content-type": contentType });
  res.end(text);
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function createOrderId() {
  return `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function validateGarments(garments) {
  if (!Array.isArray(garments) || garments.length === 0) {
    return "garments must be a non-empty array";
  }

  for (const item of garments) {
    if (!item || typeof item !== "object") {
      return "each garment must be an object";
    }

    if (typeof item.name !== "string" || !item.name.trim()) {
      return "each garment needs a name";
    }

    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return "each garment quantity must be a positive integer";
    }

    if (typeof item.price_per_item !== "number" || item.price_per_item <= 0) {
      return "each garment price_per_item must be a positive number";
    }
  }

  return null;
}

function buildOrderResponse(order) {
  return {
    order_id: order.order_id,
    user_id: order.user_id,
    customer_name: order.customer_name,
    phone_number: order.phone_number,
    garments: order.garments,
    status: order.status,
    total_amount: order.total_amount,
    estimated_delivery_date: order.estimated_delivery_date,
    created_at: order.created_at,
  };
}

function normalizeUserId(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function getDashboard(userId) {
  const counts = Object.fromEntries(statusValues.map((status) => [status, 0]));
  let totalRevenue = 0;

  const query = userId ? { user_id: userId } : {};
  const orders = await ordersCollection.find(query).toArray();

  for (const order of orders) {
    counts[order.status] += 1;
    totalRevenue += order.total_amount;
  }

  return {
    total_orders: orders.length,
    total_revenue: roundMoney(totalRevenue),
    orders_per_status: counts,
  };
}

async function serveStatic(res, pathname) {
  const staticRoot = await getStaticRoot();
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(staticRoot, safePath);

  if (!filePath.startsWith(staticRoot)) {
    sendText(res, 403, "Forbidden");
    return true;
  }

  try {
    const content = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".css"
          ? "text/css; charset=utf-8"
          : ext === ".js"
            ? "text/javascript; charset=utf-8"
            : ext === ".svg"
              ? "image/svg+xml"
              : ext === ".json"
                ? "application/json; charset=utf-8"
                : "application/octet-stream";
    res.writeHead(200, { "content-type": contentType });
    res.end(content);
  } catch {
    return false;
  }

  return true;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`,
  );
  const { pathname, searchParams } = requestUrl;

  if (req.method === "GET" && pathname === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (req.method === "GET" && pathname === "/dashboard") {
    try {
      const userId = normalizeUserId(searchParams.get("user_id"));
      if (!userId) {
        sendJson(res, 400, { error: "user_id is required" });
        return;
      }

      const dashboard = await getDashboard(userId);
      sendJson(res, 200, dashboard);
    } catch (error) {
      sendJson(res, 500, { error: "Failed to fetch dashboard" });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/orders") {
    try {
      const body = await parseBody(req);
      const userId = normalizeUserId(body.user_id);
      const customerName =
        typeof body.customer_name === "string" ? body.customer_name.trim() : "";
      const phoneNumber =
        typeof body.phone_number === "string" ? body.phone_number.trim() : "";
      const garmentError = validateGarments(body.garments);

      if (!userId) {
        sendJson(res, 400, { error: "user_id is required" });
        return;
      }

      if (!customerName) {
        sendJson(res, 400, { error: "customer_name is required" });
        return;
      }

      if (!phoneNumber) {
        sendJson(res, 400, { error: "phone_number is required" });
        return;
      }

      if (garmentError) {
        sendJson(res, 400, { error: garmentError });
        return;
      }

      const totalAmount = roundMoney(
        body.garments.reduce(
          (sum, garment) => sum + garment.quantity * garment.price_per_item,
          0,
        ),
      );
      const createdAt = new Date().toISOString();
      const estimatedDeliveryDate = new Date();
      estimatedDeliveryDate.setDate(estimatedDeliveryDate.getDate() + 3);

      const order = {
        order_id: createOrderId(),
        user_id: userId,
        customer_name: customerName,
        phone_number: phoneNumber,
        garments: body.garments.map((item) => ({
          name: item.name.trim(),
          quantity: item.quantity,
          price_per_item: item.price_per_item,
        })),
        status: "RECEIVED",
        total_amount: totalAmount,
        estimated_delivery_date: estimatedDeliveryDate
          .toISOString()
          .slice(0, 10),
        created_at: createdAt,
      };

      await ordersCollection.insertOne(order);
      sendJson(res, 201, buildOrderResponse(order));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/orders") {
    try {
      const status = searchParams.get("status");
      const search = searchParams.get("search");
      const userId = normalizeUserId(searchParams.get("user_id"));

      if (!userId) {
        sendJson(res, 400, { error: "user_id is required" });
        return;
      }

      const query = { user_id: userId };

      if (status) {
        query.status = status;
      }

      let result = await ordersCollection.find(query).toArray();

      if (search) {
        const needle = search.trim().toLowerCase();
        result = result.filter(
          (order) =>
            order.customer_name.toLowerCase().includes(needle) ||
            order.phone_number.toLowerCase().includes(needle),
        );
      }

      result.sort((a, b) => b.created_at.localeCompare(a.created_at));
      sendJson(res, 200, result.map(buildOrderResponse));
    } catch (error) {
      sendJson(res, 500, { error: "Failed to fetch orders" });
    }
    return;
  }

  const orderStatusMatch = pathname.match(/^\/orders\/([^/]+)\/status$/);
  if (req.method === "PATCH" && orderStatusMatch) {
    try {
      const orderId = decodeURIComponent(orderStatusMatch[1]);
      const body = await parseBody(req);
      const userId = normalizeUserId(body.user_id);

      if (!userId) {
        sendJson(res, 400, { error: "user_id is required" });
        return;
      }

      const order = await ordersCollection.findOne({
        order_id: orderId,
        user_id: userId,
      });

      if (!order) {
        sendJson(res, 404, { error: "Order not found" });
        return;
      }

      if (!statusValues.includes(body.status)) {
        sendJson(res, 400, { error: "Invalid status" });
        return;
      }

      const updatedOrder = { ...order, status: body.status };
      await ordersCollection.updateOne(
        { order_id: orderId, user_id: userId },
        { $set: { status: body.status } },
      );
      sendJson(res, 200, buildOrderResponse(updatedOrder));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const orderMatch = pathname.match(/^\/orders\/([^/]+)$/);
  if (req.method === "GET" && orderMatch) {
    try {
      const orderId = decodeURIComponent(orderMatch[1]);
      const userId = normalizeUserId(searchParams.get("user_id"));

      if (!userId) {
        sendJson(res, 400, { error: "user_id is required" });
        return;
      }

      const order = await ordersCollection.findOne({
        order_id: orderId,
        user_id: userId,
      });

      if (!order) {
        sendJson(res, 404, { error: "Order not found" });
        return;
      }

      sendJson(res, 200, buildOrderResponse(order));
    } catch (error) {
      sendJson(res, 500, { error: "Failed to fetch order" });
    }
    return;
  }

  if (req.method === "GET") {
    const served = await serveStatic(res, pathname);
    if (served) {
      return;
    }

    if (!path.extname(pathname)) {
      const servedIndex = await serveStatic(res, "/index.html");
      if (servedIndex) {
        return;
      }
    }
  }

  sendText(res, 404, "Not found");
});

const port = Number.parseInt(process.env.PORT || "3000", 10);

async function startServer() {
  await connectDatabase();

  server.listen(port, () => {
    console.log(`Laundry Desk running on http://127.0.0.1:${port}`);
  });
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  if (client) {
    await client.close();
    console.log("MongoDB connection closed");
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down...");
  if (client) {
    await client.close();
    console.log("MongoDB connection closed");
  }
  process.exit(0);
});

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
