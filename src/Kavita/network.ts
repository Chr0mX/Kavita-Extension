/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kavita Extension Contributors */

import { PaperbackInterceptor, type Request, type Response } from "@paperback/types";

import { ensureToken } from "./auth";
import { apiUrl, getCredentials } from "./settings";

// Injects the Kavita bearer token into every API request. Image requests
// authenticate via the apiKey query parameter and are left untouched.
export class KavitaInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const { serverUrl } = getCredentials();
    if (!serverUrl) {
      return request;
    }

    // Only attach credentials to calls aimed at this server's API.
    const base = apiUrl(serverUrl);
    if (!request.url.startsWith(base)) {
      return request;
    }

    let authorization: string;
    try {
      authorization = await ensureToken();
    } catch {
      // Let the request proceed unauthenticated; the caller handles the error.
      return request;
    }

    request.headers = {
      ...request.headers,
      Authorization: authorization,
      ...(typeof request.body === "string" ? { "Content-Type": "application/json" } : {}),
    };
    return request;
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    void request;
    void response;
    return data;
  }
}
