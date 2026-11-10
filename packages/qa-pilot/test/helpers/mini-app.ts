import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A tiny two-page shop for fast agent tests that don't need the Next.js demo.
 * `renamed` changes the button label, like DEMO_RENAME does in the demo shop.
 */
export interface MiniAppOptions {
  renamed?: boolean;
}

const page = (title: string, body: string) => `<!doctype html>
<html><head><title>${title}</title></head><body>
<header><a href="/">Mini shop</a> <a href="/cart" id="cart-link">Cart (<span id="count">0</span>)</a></header>
<main>${body}</main>
<script>
  const cart = JSON.parse(localStorage.getItem("cart") || "0");
  document.getElementById("count").textContent = cart;
</script>
</body></html>`;

export function miniAppHtml(
  path: string,
  opts: MiniAppOptions = {},
): { status: number; body: string } {
  const button = opts.renamed ? "Add to bag" : "Add to cart";
  if (path === "/" || path === "/index.html") {
    return {
      status: 200,
      body: page(
        "Mini shop",
        `<h1>Trail mug</h1><p>Price: $18.00</p>
         <button id="add">${button}</button>
         <p id="msg" role="status"></p>
         <script>
           document.getElementById("add").onclick = () => {
             const n = JSON.parse(localStorage.getItem("cart") || "0") + 1;
             localStorage.setItem("cart", JSON.stringify(n));
             document.getElementById("count").textContent = n;
             document.getElementById("msg").textContent = "Added to cart";
           };
         </script>`,
      ),
    };
  }
  if (path === "/cart") {
    return {
      status: 200,
      body: page(
        "Your cart",
        `<h1>Your cart</h1>
         <label for="qty">Quantity</label>
         <select id="qty"><option>1</option><option>2</option><option>3</option></select>
         <p>Total: <output id="total">$18.00</output></p>
         <script>
           document.getElementById("qty").onchange = (e) => {
             document.getElementById("total").textContent = "$" + (18 * Number(e.target.value)).toFixed(2);
           };
           console.error("cart widget warning");
           fetch("/api/missing");
         </script>`,
      ),
    };
  }
  return { status: 404, body: "not found" };
}

export async function startMiniApp(
  opts: MiniAppOptions = {},
): Promise<{ url: string; server: Server; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const { status, body } = miniAppHtml(new URL(req.url ?? "/", "http://x").pathname, opts);
    res.writeHead(status, { "content-type": status === 200 ? "text/html" : "text/plain" });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
