import type { APIResponse } from "playwright";
import { ProviderError } from "./provider";
export async function readLinkedInResponse(response:APIResponse) {
  const status=response.status();const headers=response.headers();const retry=headers["retry-after"];
  const parsed=retry?(/^\d+(?:\.\d+)?$/.test(retry)?Number(retry)*1000:Date.parse(retry)-Date.now()):NaN;
  const retryAfterMs=Number.isFinite(parsed)&&parsed>=0?parsed:undefined;
  try {
    // Error status is authoritative even if the error body is HTML or invalid JSON.
    if(status<200||status>=300)return {status,json:null,retryAfterMs};
    if(!headers["content-type"]?.includes("json"))throw new ProviderError("unsupported","Unsupported LinkedIn content type");
    const body=await response.body();if(body.length>5000000)throw new ProviderError("unsupported","LinkedIn response too large");
    let json:unknown;try{json=JSON.parse(body.toString("utf8"))}catch{throw new ProviderError("unsupported","Unsupported LinkedIn JSON response")}
    return {status,json,retryAfterMs};
  }finally{await response.dispose()}
}
