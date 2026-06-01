// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useCallback, useRef } from "react";

import Log from "@lichtblick/log";

const log = Log.getLogger(__filename);

const RECORDING_PORT = 8766;

type RecordingResponse = {
  status: "ok" | "error";
  state?: "recording" | "idle";
  bag_file?: string;
  message?: string;
};

/**
 * Derives the recording WebSocket URL from the Foxglove data source URL
 * by replacing the port with 8766.
 */
function getRecordingUrl(foxgloveWsUrl: string): string {
  try {
    const url = new URL(foxgloveWsUrl);
    url.port = String(RECORDING_PORT);
    return url.toString();
  } catch {
    return `ws://localhost:${RECORDING_PORT}`;
  }
}

/**
 * Sends a recording command to the recording WebSocket endpoint and returns the response.
 */
async function sendRecordingCommand(
  wsUrl: string,
  command: "start" | "stop" | "status",
): Promise<RecordingResponse> {
  return await new Promise<RecordingResponse>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Recording command timed out"));
    }, 5000);

    ws.onopen = () => {
      const message = JSON.stringify({ command });
      ws.send(message!);
    };

    ws.onmessage = (event) => {
      clearTimeout(timeout);
      try {
        const data = typeof event.data === "string" ? event.data : String(event.data);
        const response = JSON.parse(data) as RecordingResponse;
        resolve(response);
      } catch (err) {
        reject(new Error("Invalid response from recording server"));
      }
      ws.close();
    };

    ws.onerror = (event) => {
      clearTimeout(timeout);
      log.error("Recording WebSocket error:", event);
      reject(new Error("Failed to connect to recording server"));
    };

    ws.onclose = (event) => {
      clearTimeout(timeout);
      if (!event.wasClean && event.code !== 1000) {
        reject(new Error("Recording connection closed unexpectedly"));
      }
    };
  });
}

export type UseRecordingResult = {
  startRecording: () => Promise<RecordingResponse>;
  stopRecording: () => Promise<RecordingResponse>;
};

/**
 * Hook for controlling recording via a separate WebSocket on port 8766.
 * @param foxgloveWsUrl The current Foxglove WebSocket data source URL
 */
export function useRecording(foxgloveWsUrl: string | undefined): UseRecordingResult {
  const urlRef = useRef(foxgloveWsUrl);
  urlRef.current = foxgloveWsUrl;

  const startRecording = useCallback(async (): Promise<RecordingResponse> => {
    if (!urlRef.current) {
      throw new Error("No WebSocket URL available");
    }
    const recordingUrl = getRecordingUrl(urlRef.current);
    return await sendRecordingCommand(recordingUrl, "start");
  }, []);

  const stopRecording = useCallback(async (): Promise<RecordingResponse> => {
    if (!urlRef.current) {
      throw new Error("No WebSocket URL available");
    }
    const recordingUrl = getRecordingUrl(urlRef.current);
    return await sendRecordingCommand(recordingUrl, "stop");
  }, []);

  return { startRecording, stopRecording };
}
