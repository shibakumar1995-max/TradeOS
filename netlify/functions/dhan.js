// Netlify Function — Dhan API Proxy
// Runs server-side, no CORS issues
const https = require("https");

exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

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
    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: "api.dhan.co",
        path: `/v2${endpoint}`,
        method,
        headers: {
          "Content-Type": "application/json",
          "access-token": token,
          "dhanClientId": clientId,
        },
      };
      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => data += chunk);
        res.on("end", () => resolve(data));
      });
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });

    return { statusCode: 200, headers: { ...CORS, "Content-Type": "application/json" }, body: result };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
