const https = require("https");
const CORS = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"GET,POST,OPTIONS"};

function req(path, method, body, token, clientId){
  return new Promise((resolve, reject) => {
    const o={hostname:"api.dhan.co",path:`/v2${path}`,method:method||"GET",
      headers:{"Content-Type":"application/json","access-token":token,"dhanClientId":clientId}};
    const r=https.request(o,res=>{let d="";res.on("data",c=>d+=c);res.on("end",()=>{try{resolve(JSON.parse(d));}catch{resolve(d);}});});
    r.on("error",reject);if(body)r.write(typeof body==="string"?body:JSON.stringify(body));r.end();
  });
}

function calcPnL(p){
  // Try API fields first (should be signed)
  let realized = parseFloat(p.realizedProfit ?? p.realizedPnl ?? p.realizedGain ?? "NaN");
  let unrealized = parseFloat(p.unrealizedProfit ?? p.unrealizedPnl ?? p.mtmValue ?? p.mtm ?? "NaN");

  const buyAvg = parseFloat(p.buyAvg ?? p.costPrice ?? 0);
  const sellAvg = parseFloat(p.sellAvg ?? p.averageSellPrice ?? 0);
  const buyQty = parseFloat(p.buyQty ?? p.totalBuyQty ?? 0);
  const sellQty = parseFloat(p.sellQty ?? p.totalSellQty ?? 0);
  const netQty = parseFloat(p.netQty ?? (buyQty - sellQty));
  const mult = parseFloat(p.multiplier ?? 1);

  // If API returns 0 or NaN for realized, calculate manually from averages
  if (isNaN(realized) || realized === 0) {
    if (buyQty > 0 && sellQty > 0 && buyAvg > 0 && sellAvg > 0) {
      const closedQty = Math.min(buyQty, sellQty);
      // For BUY trades: profit = (sell - buy) * qty
      // For SELL trades (short): profit = (buy - sell) * qty
      if (buyQty >= sellQty) {
        realized = (sellAvg - buyAvg) * closedQty * mult;
      } else {
        realized = (buyAvg - sellAvg) * closedQty * mult;
      }
    } else {
      realized = 0;
    }
  }

  if (isNaN(unrealized)) unrealized = 0;

  return { realized: parseFloat(realized.toFixed(2)), unrealized: parseFloat(unrealized.toFixed(2)) };
}

exports.handler = async (event) => {
  if(event.httpMethod==="OPTIONS") return{statusCode:200,headers:CORS,body:""};
  const token=process.env.DHAN_TOKEN;
  const clientId=process.env.DHAN_CLIENT_ID;
  if(!token||!clientId) return{statusCode:500,headers:CORS,body:JSON.stringify({error:"DHAN_TOKEN or DHAN_CLIENT_ID not set"})};

  const endpoint=event.queryStringParameters?.endpoint||"/fundlimit";
  const method=event.httpMethod==="POST"?"POST":"GET";
  const body=event.body||null;

  try{
    // Special: enriched positions
    if(endpoint==="/allpositions"){
      const positions=await req("/positions","GET",null,token,clientId);
      if(!Array.isArray(positions)){
        return{statusCode:200,headers:{...CORS,"Content-Type":"application/json"},body:JSON.stringify([])};
      }

      const trades=positions.map(p=>{
        const{realized,unrealized}=calcPnL(p);
        const buyQty=parseFloat(p.buyQty??p.totalBuyQty??0);
        const sellQty=parseFloat(p.sellQty??p.totalSellQty??0);
        const netQty=parseFloat(p.netQty??(buyQty-sellQty));
        const qty=Math.abs(netQty)||Math.max(buyQty,sellQty);
        const isClosed=netQty===0&&(buyQty>0||sellQty>0);
        const type=netQty>=0?"BUY":"SELL";
        return{
          id: String(p.securityId||Date.now())+"_"+(p.positionType||""),
          symbol: p.tradingSymbol||p.securityId||"Unknown",
          date: new Date().toISOString().split("T")[0],
          type, qty,
          buyAvg: parseFloat(p.buyAvg??p.costPrice??0),
          sellAvg: parseFloat(p.sellAvg??0),
          pnl: realized+unrealized,
          realizedPnl: realized,
          unrealizedPnl: unrealized,
          isClosed,
          product: p.productType||p.product||"",
          rr:0,sl:0,grade:"",setup:"",emotion:"",lesson:"",confidence:5,exitType:"",holdTime:0,
        };
      });

      return{statusCode:200,headers:{...CORS,"Content-Type":"application/json"},body:JSON.stringify(trades)};
    }

    // Default proxy
    const result=await req(endpoint,method,body?JSON.parse(body):null,token,clientId);
    return{statusCode:200,headers:{...CORS,"Content-Type":"application/json"},body:JSON.stringify(result)};
  }catch(err){
    return{statusCode:500,headers:CORS,body:JSON.stringify({error:err.message})};
  }
};
