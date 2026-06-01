// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import ClearIcon from "@mui/icons-material/Clear";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import FileUploadIcon from "@mui/icons-material/FileUpload";
import SearchIcon from "@mui/icons-material/Search";
import {
  AppBar,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  InputAdornment,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useMemo, useRef, useState } from "react";
import { makeStyles } from "tss-react/mui";

import Log from "@lichtblick/log";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import Stack from "@lichtblick/suite-base/components/Stack";
import {
  DataSourceEvent,
  EventsStore,
  TimelinePositionedEvent,
  useEvents,
} from "@lichtblick/suite-base/context/EventsContext";
import {
  TimelineInteractionStateStore,
  useTimelineInteractionState,
} from "@lichtblick/suite-base/context/TimelineInteractionStateContext";
import { useAppTimeFormat } from "@lichtblick/suite-base/hooks";

import { CreateEventDialog } from "./CreateEventDialog";
import { EventView } from "./EventView";

const log = Log.getLogger(__filename);

const useStyles = makeStyles()((theme) => ({
  appBar: {
    top: -1,
    zIndex: theme.zIndex.appBar - 1,
    display: "flex",
    flexDirection: "row",
    padding: theme.spacing(1),
    gap: theme.spacing(1),
    alignItems: "center",
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  toolbar: {
    display: "flex",
    flexDirection: "row",
    padding: theme.spacing(0.5, 1),
    gap: theme.spacing(0.5),
    alignItems: "center",
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
  grid: {
    display: "grid",
    flexShrink: 1,
    gridTemplateColumns: "auto 1fr",
    overflowY: "auto",
    padding: theme.spacing(1),
  },
  root: {
    backgroundColor: theme.palette.background.paper,
    maxHeight: "100%",
  },
}));

const selectSeek = (ctx: MessagePipelineContext) => ctx.seekPlayback;
const selectEventFilter = (store: EventsStore) => store.filter;
const selectSetEventFilter = (store: EventsStore) => store.setFilter;
const selectEvents = (store: EventsStore) => store.events;
const selectHoveredEvent = (store: TimelineInteractionStateStore) => store.hoveredEvent;
const selectSetHoveredEvent = (store: TimelineInteractionStateStore) => store.setHoveredEvent;
const selectEventsAtHoverValue = (store: TimelineInteractionStateStore) => store.eventsAtHoverValue;
const selectSelectedEventId = (store: EventsStore) => store.selectedEventId;
const selectSelectEvent = (store: EventsStore) => store.selectEvent;

export function EventsList(): React.JSX.Element {
  const events = useEvents(selectEvents);
  const selectedEventId = useEvents(selectSelectedEventId);
  const selectEvent = useEvents(selectSelectEvent);
  const { formatTime } = useAppTimeFormat();
  const seek = useMessagePipeline(selectSeek);
  const eventsAtHoverValue = useTimelineInteractionState(selectEventsAtHoverValue);
  const hoveredEvent = useTimelineInteractionState(selectHoveredEvent);
  const setHoveredEvent = useTimelineInteractionState(selectSetHoveredEvent);
  const filter = useEvents(selectEventFilter);
  const setFilter = useEvents(selectSetEventFilter);

  const [editingEvent, setEditingEvent] = useState<DataSourceEvent | undefined>();
  const [deletingEvent, setDeletingEvent] = useState<TimelinePositionedEvent | undefined>();
  const deleteEvent = useEvents((store) => store.deleteEvent);
  const importEvents = useEvents((store) => store.importEvents);
  const exportEvents = useEvents((store) => store.exportEvents);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onEdit = useCallback((event: TimelinePositionedEvent) => {
    setEditingEvent(event.event);
  }, []);

  const onDelete = useCallback((event: TimelinePositionedEvent) => {
    setDeletingEvent(event);
  }, []);

  const confirmDelete = useCallback(() => {
    if (deletingEvent) {
      deleteEvent?.(deletingEvent.event.id).catch((err: unknown) => {
        log.error(err);
      });
      setDeletingEvent(undefined);
    }
  }, [deleteEvent, deletingEvent]);

  const cancelDelete = useCallback(() => {
    setDeletingEvent(undefined);
  }, []);

  const handleExport = useCallback(async () => {
    if (!exportEvents) {
      return;
    }
    try {
      const allEvents = await exportEvents();
      if (!allEvents || allEvents.length === 0) {
        return;
      }
      const json: string = JSON.stringify(allEvents, null, 2) ?? "[]";
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `events-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      log.error(err);
    }
  }, [exportEvents]);

  const handleImport = useCallback(
    async (fileEvent: React.ChangeEvent<HTMLInputElement>) => {
      const file = fileEvent.target.files?.[0];
      if (!file || !importEvents) {
        return;
      }
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as DataSourceEvent[];
        if (!Array.isArray(parsed)) {
          throw new Error("Invalid events file: expected an array");
        }
        await importEvents(parsed);
      } catch (err) {
        log.error(err);
      }
      // Reset the input so the same file can be re-imported
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [importEvents],
  );

  const timestampedEvents = useMemo(
    () =>
      (events.value ?? []).map((event) => {
        return { ...event, formattedTime: formatTime(event.event.startTime) };
      }),
    [events, formatTime],
  );

  const clearFilter = useCallback(() => {
    setFilter("");
  }, [setFilter]);

  const onClick = useCallback(
    (event: TimelinePositionedEvent) => {
      if (event.event.id === selectedEventId) {
        selectEvent(undefined);
      } else {
        selectEvent(event.event.id);
      }

      if (seek) {
        seek(event.event.startTime);
      }
    },
    [seek, selectEvent, selectedEventId],
  );

  const onHoverEnd = useCallback(() => {
    setHoveredEvent(undefined);
  }, [setHoveredEvent]);

  const onHoverStart = useCallback(
    (event: TimelinePositionedEvent) => {
      setHoveredEvent(event);
    },
    [setHoveredEvent],
  );

  const { classes } = useStyles();

  return (
    <Stack className={classes.root} fullHeight>
      <AppBar className={classes.appBar} position="sticky" color="inherit" elevation={0}>
        <TextField
          variant="filled"
          fullWidth
          size="small"
          value={filter}
          onChange={(event) => {
            setFilter(event.currentTarget.value);
          }}
          placeholder="Search by key, value, or key:value"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: filter !== "" && (
                <IconButton edge="end" onClick={clearFilter} size="small">
                  <ClearIcon fontSize="small" />
                </IconButton>
              ),
            },
          }}
        />
      </AppBar>
      <div className={classes.toolbar}>
        <Tooltip title="Import events">
          <IconButton
            size="small"
            onClick={() => {
              fileInputRef.current?.click();
            }}
          >
            <FileUploadIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Export events">
          <IconButton size="small" onClick={() => void handleExport()}>
            <FileDownloadIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: "none" }}
          onChange={(e) => void handleImport(e)}
        />
      </div>
      {events.loading && (
        <Stack flex="auto" padding={2} fullHeight alignItems="center" justifyContent="center">
          <CircularProgress />
        </Stack>
      )}
      {events.error && (
        <Stack flex="auto" padding={2} fullHeight alignItems="center" justifyContent="center">
          <Typography align="center" color="error">
            Error loading events.
          </Typography>
        </Stack>
      )}
      {events.value?.length === 0 && (
        <Stack flex="auto" padding={2} fullHeight alignItems="center" justifyContent="center">
          <Typography align="center" color="text.secondary">
            No Events
          </Typography>
        </Stack>
      )}
      <div className={classes.grid}>
        {timestampedEvents.map((event) => {
          return (
            <EventView
              key={event.event.id}
              event={event}
              filter={filter}
              formattedTime={event.formattedTime}
              // When hovering within the event list only show hover state on directly
              // hovered event.
              isHovered={
                hoveredEvent
                  ? event.event.id === hoveredEvent.event.id
                  : eventsAtHoverValue[event.event.id] != undefined
              }
              isSelected={event.event.id === selectedEventId}
              onClick={onClick}
              onHoverStart={onHoverStart}
              onHoverEnd={onHoverEnd}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          );
        })}
      </div>
      {editingEvent && (
        <CreateEventDialog
          onClose={() => {
            setEditingEvent(undefined);
          }}
          editingEvent={editingEvent}
        />
      )}
      <Dialog open={deletingEvent != undefined} onClose={cancelDelete}>
        <DialogTitle>Delete Event</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete this event? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={cancelDelete}>Cancel</Button>
          <Button onClick={confirmDelete} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
