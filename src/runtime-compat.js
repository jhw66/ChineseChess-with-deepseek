import http from "node:http";
import https from "node:https";

/**
 * EXE 版本内置的是体积较小的 Node 运行时（Node 14），它没有全局 fetch 和
 * AbortController。这里在缺什么补什么，保证同一份源码在开发和打包后行为一致。
 */

class AbortSignalCompat {
  constructor() {
    this.aborted = false;
    this.reason = undefined;
    this.listeners = new Set();
  }

  addEventListener(type, listener) {
    if (type === "abort" && typeof listener === "function") {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type, listener) {
    if (type === "abort") this.listeners.delete(listener);
  }

  dispatchAbort() {
    for (const listener of this.listeners) listener();
    this.listeners.clear();
  }
}

class AbortControllerCompat {
  constructor() {
    this.signal = new AbortSignalCompat();
  }

  abort(reason = new Error("The operation was aborted")) {
    if (this.signal.aborted) return;
    this.signal.aborted = true;
    this.signal.reason = reason;
    this.signal.dispatchAbort();
  }
}

function responseFromRequest(request, resolve, reject, signal) {
  const onAbort = () => {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    request.destroy(error);
  };

  if (signal) {
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort);
  }

  request.on("response", (incoming) => {
    const chunks = [];
    incoming.on("data", (chunk) => chunks.push(chunk));
    incoming.on("end", () => {
      signal?.removeEventListener("abort", onAbort);
      const text = Buffer.concat(chunks).toString("utf8");
      resolve({
        ok: incoming.statusCode >= 200 && incoming.statusCode < 300,
        status: incoming.statusCode ?? 0,
        statusText: incoming.statusMessage ?? "",
        headers: incoming.headers,
        text: async () => text,
        json: async () => JSON.parse(text),
      });
    });
  });
  request.on("error", (error) => {
    signal?.removeEventListener("abort", onAbort);
    reject(error);
  });
}

function compatFetch(input, init = {}) {
  return new Promise((resolve, reject) => {
    const url = input instanceof URL ? input : new URL(String(input));
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(
      url,
      {
        method: init.method || "GET",
        headers: init.headers || {},
      },
      () => {},
    );

    responseFromRequest(request, resolve, reject, init.signal);
    if (init.body != null) request.write(init.body);
    request.end();
  });
}

export function installRuntimeCompatibility() {
  if (typeof globalThis.fetch !== "function") {
    globalThis.fetch = compatFetch;
  }
  if (typeof globalThis.AbortController !== "function") {
    globalThis.AbortController = AbortControllerCompat;
  }
}

installRuntimeCompatibility();
