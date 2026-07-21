// Shared request/response shapes for the share API. Imported by both the React
// client and the Cloudflare Worker so the wire format stays in one place.
import type { TransitSystem } from "../model/system";

export interface CreateShareRequest {
  system: TransitSystem;
}

export interface CreateShareResponse {
  id: string;
}

export interface GetShareResponse {
  id: string;
  system: TransitSystem;
  createdAt: number;
}

export interface ApiError {
  error: string;
}
