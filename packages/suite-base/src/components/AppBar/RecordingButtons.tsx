// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import StopIcon from "@mui/icons-material/Stop";
import { Button } from "@mui/material";
import { useSnackbar } from "notistack";
import { useCallback } from "react";
import { makeStyles } from "tss-react/mui";

import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import { useRecording } from "@lichtblick/suite-base/hooks/useRecording";

const useStyles = makeStyles()((theme) => ({
  recordButton: {
    minWidth: "auto",
    padding: theme.spacing(0.5, 1),
    fontSize: theme.typography.caption.fontSize,
    textTransform: "none",
  },
  startIcon: {
    color: theme.palette.error.main,
  },
  stopIcon: {
    color: theme.palette.text.primary,
  },
}));

const selectUrlState = (ctx: MessagePipelineContext) => ctx.playerState.urlState;

export function RecordingButtons(): React.JSX.Element | undefined {
  const { classes } = useStyles();
  const { enqueueSnackbar } = useSnackbar();
  const urlState = useMessagePipeline(selectUrlState);

  // Only show when connected to foxglove-websocket data source
  const isFoxgloveWs = urlState?.sourceId === "foxglove-websocket";
  const wsUrl = isFoxgloveWs ? (urlState?.parameters?.url as string | undefined) : undefined;

  const { startRecording, stopRecording } = useRecording(wsUrl);

  const handleStart = useCallback(async () => {
    try {
      const response = await startRecording();
      if (response.status === "ok") {
        enqueueSnackbar(`录制已开始: ${response.bag_file ?? ""}`, { variant: "success", autoHideDuration: 10000 });
      } else {
        enqueueSnackbar(response.message ?? "开始录制失败", { variant: "warning", autoHideDuration: 10000 });
      }
    } catch (err) {
      enqueueSnackbar(`录制错误: ${(err as Error).message}`, { variant: "error", autoHideDuration: 10000 });
    }
  }, [startRecording, enqueueSnackbar]);

  const handleStop = useCallback(async () => {
    try {
      const response = await stopRecording();
      if (response.status === "ok") {
        enqueueSnackbar(`录制已停止: ${response.bag_file ?? ""}`, { variant: "success", autoHideDuration: 10000 });
      } else {
        enqueueSnackbar(response.message ?? "停止录制失败", { variant: "warning", autoHideDuration: 10000 });
      }
    } catch (err) {
      enqueueSnackbar(`录制错误: ${(err as Error).message}`, { variant: "error", autoHideDuration: 10000 });
    }
  }, [stopRecording, enqueueSnackbar]);

  if (!isFoxgloveWs) {
    return undefined;
  }

  return (
    <>
      <Button
        className={classes.recordButton}
        variant="text"
        color="inherit"
        size="small"
        startIcon={<FiberManualRecordIcon className={classes.startIcon} fontSize="small" />}
        onClick={() => void handleStart()}
      >
        开始录制
      </Button>
      <Button
        className={classes.recordButton}
        variant="text"
        color="inherit"
        size="small"
        startIcon={<StopIcon className={classes.stopIcon} fontSize="small" />}
        onClick={() => void handleStop()}
      >
        结束录制
      </Button>
    </>
  );
}
