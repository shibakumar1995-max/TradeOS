const https = require("https");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function dhanRequest(path, method, body, token, clientId) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.dhan.co",
      path: `/v2${path}`,
      method: method || "GET",
      headers: {
        "Content-Type": "application/json",
        "access-token": token,
        "dhanClientId": clientId,
      },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(data); }
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

// Calculate P&L from position fields
function calcPnL(p) {
  // Try realizedProfit first (closed positions)
  let realized = parseFloat(p.realizedProfit || p.realizedPnl || p.realizedGain || 0);
  // Try unrealizedProfit (open positions)  
  let unrealized = parseFloat(p.unrealizedProfit || p.unrealizedPnl || p.mtmValue || p.mtm || 0);
  
  // If both are 0, calculate manually from buy/sell averages
  if (realized === 0 && unrealized === 0) {
    const buyAvg = parseFloat(p.buyAvg || p.averageBuyPrice || p.buyVal / p.buyQty || 0);
    const sellAvg = parseFloat(p.sellAvg || p.averageSellPrice || p.sellVal / p.sellQty || 0);
    const buyQty = parseFloat(p.buyQty || p.totalBuyQty || 0);
    const sellQty = parseFloat(p.sellQty || p.totalSellQty || 0);
    const mult = parseFloat(p.multiplier || 1);
    if (buyQty > 0 && sellQty > 0) {
      // Closed or partially closed
      const closedQty = Math.min(buyQty, sellQty);
      realized = (sellAvg - buyAvg) * closedQty * mult;
    }
    // Open unrealized: LTP not available without market data sub, skip
  }
  
  return { realized, unrealized, total: realized + unrealized };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  const token    = process.env.DHAN_TOKEN;
  const clientId = process.env.DHAN_CLIENT_ID;

  if (!token || !clientId) {
    return { statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: "DHAN_TOKEN or DHAN_CLIENT_ID not set in Netlify environment variables" }) };
  }

  const endpoint = event.queryStringParameters?.endpoint || "/fundlimit";
  const method   = event.httpMethod === "POST" ? "POST" : "GET";
  const body     = event.body || null;

  try {
    // Special handled endpoint: /allpositions returns enriched position data
    if (endpoint === "/allpositions") {
      const positions = await dhanRequest("/positions", "GET", null, token, clientId);
      
      if (!Array.isArray(positions)) {
        return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" },
          body: JSON.stringify({ raw: positions, trades: [] }) };
      }

      const trades = positions.map(p => {
        const { realized, unrealized, total } = calcPnL(p);
        const buyQty  = parseFloat(p.buyQty || p.totalBuyQty || 0);
        const sellQty = parseFloat(p.sellQty || p.totalSellQty || 0);
        const netQty  = parseFloat(p.netQty || (buyQty - sellQty));
        const type    = netQty >= 0 ? "BUY" : "SELL";
        const qty     = Math.abs(netQty) || Math.max(buyQty, sellQty);
        const isClosed = (p.positionType === "CLOSED" || netQty === 0) && (buyQty > 0 || sellQty > 0);
        
        return {
          id: p.securityId + "_" + (p.positionType || ""),
          symbol: p.tradingSymbol || p.securityId || "Unknown",
          date:   new Date().toISOString().split("T")[0],
          type,
          qty,
          buyAvg:  parseFloat(p.buyAvg || p.costPrice || 0),
          sellAvg: parseFloat(p.sellAvg || 0),
          pnl:     parseFloat(total.toFixed(2)),
          realizedPnl:   parseFloat(realized.toFixed(2)),
          unrealizedPnl: parseFloat(unrealized.toFixed(2)),
          isClosed,
          product: p.productType || p.product || "",
          rr: 0, sl: 0, grade: "B", setup: "", emotion: "", lesson: "", confidence: 5,
          // pass raw for debugging
          _raw: p,
        };
      });

      return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify(trades) };
    }

    // Default: proxy any Dhan endpoint
    const result = await dhanRequest(endpoint, method, body ? JSON.parse(body) : null, token, clientId);
    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify(result) };

  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
