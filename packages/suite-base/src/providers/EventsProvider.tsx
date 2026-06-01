// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createStore, get, update as idbUpdate } from "idb-keyval";
import { ReactNode, useEffect, useState } from "react";
import { AsyncState } from "react-use/lib/useAsyncFn";
import { v4 as uuidv4 } from "uuid";
import { createStore as createZustandStore } from "zustand";

import Log from "@lichtblick/log";
import { fromDate, subtract, toNanoSec, toSec } from "@lichtblick/rostime";
import {
  MessagePipelineContext,
  useMessagePipeline,
} from "@lichtblick/suite-base/components/MessagePipeline";
import {
  DataSourceEvent,
  EventsContext,
  EventsStore,
  TimelinePositionedEvent,
} from "@lichtblick/suite-base/context/EventsContext";

const log = Log.getLogger(__filename);

const NO_EVENTS: TimelinePositionedEvent[] = [];
const EVENTS_DB_NAME = "lichtblick-events";
const EVENTS_STORE_NAME = "events";

const eventsDbStore = createStore(EVENTS_DB_NAME, EVENTS_STORE_NAME);

const selectStartTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.startTime;
const selectEndTime = (ctx: MessagePipelineContext) => ctx.playerState.activeData?.endTime;
const selectPlayerName = (ctx: MessagePipelineContext) => ctx.playerState.name;

function createEventsStore() {
  return createZustandStore<EventsStore>((set, getStore) => ({
    eventFetchCount: 0,
    events: { loading: false, value: NO_EVENTS },
    filter: "",
    selectedEventId: undefined,
    eventsSupported: true,
    deviceId: undefined,

    refreshEvents: () => {
      set((old) => ({ eventFetchCount: old.eventFetchCount + 1 }));
    },
    selectEvent: (id: undefined | string) => {
      set({ selectedEventId: id });
    },
    setEvents: (events: AsyncState<TimelinePositionedEvent[]>) => {
      set({ events, selectedEventId: undefined });
    },
    setFilter: (filter: string) => {
      set({ filter });
    },
    // eslint-disable-next-line @lichtblick/no-boolean-parameters
    setEventsSupported: (eventsSupported: boolean) => {
      set({ eventsSupported });
    },
    setDeviceId: (deviceId: string | undefined) => {
      set({ deviceId });
    },

    createEvent: async (args) => {
      const newEvent: DataSourceEvent = {
        id: uuidv4(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deviceId: args.deviceId,
        timestampNanos: toNanoSec(fromDate(new Date(args.timestamp))).toString(),
        durationNanos: args.durationNanos,
        metadata: args.metadata,
        startTime: { sec: 0, nsec: 0 },
        endTime: { sec: 0, nsec: 0 },
        startTimeInSeconds: 0,
        endTimeInSeconds: 0,
      };

      const startNanos = BigInt(newEvent.timestampNanos);
      const durationNanos = BigInt(newEvent.durationNanos);
      const endNanos = startNanos + durationNanos;

      newEvent.startTime = {
        sec: Number(startNanos / 1_000_000_000n),
        nsec: Number(startNanos % 1_000_000_000n),
      };
      newEvent.endTime = {
        sec: Number(endNanos / 1_000_000_000n),
        nsec: Number(endNanos % 1_000_000_000n),
      };
      newEvent.startTimeInSeconds = newEvent.startTime.sec + newEvent.startTime.nsec / 1e9;
      newEvent.endTimeInSeconds = newEvent.endTime.sec + newEvent.endTime.nsec / 1e9;

      await idbUpdate(
        args.deviceId,
        (oldEvents: DataSourceEvent[] | undefined) => {
          return [...(oldEvents ?? []), newEvent];
        },
        eventsDbStore,
      );

      set((old) => ({ eventFetchCount: old.eventFetchCount + 1 }));
    },

    editEvent: async (updatedEvent: DataSourceEvent) => {
      const eventToSave = { ...updatedEvent, updatedAt: new Date().toISOString() };
      await idbUpdate(
        eventToSave.deviceId,
        (oldEvents: DataSourceEvent[] | undefined) => {
          if (!oldEvents) {
            return [eventToSave];
          }
          return oldEvents.map((e) => (e.id === eventToSave.id ? eventToSave : e));
        },
        eventsDbStore,
      );
      set((old) => ({ eventFetchCount: old.eventFetchCount + 1 }));
    },

    deleteEvent: async (eventId: string) => {
      const deviceId = getStore().deviceId;
      if (!deviceId) {
        return;
      }
      await idbUpdate(
        deviceId,
        (oldEvents: DataSourceEvent[] | undefined) => {
          return (oldEvents ?? []).filter((e) => e.id !== eventId);
        },
        eventsDbStore,
      );
      set((old) => ({ eventFetchCount: old.eventFetchCount + 1 }));
    },

    importEvents: async (events: DataSourceEvent[]) => {
      const deviceId = getStore().deviceId;
      if (!deviceId) {
        return;
      }
      await idbUpdate(
        deviceId,
        (oldEvents: DataSourceEvent[] | undefined) => {
          const existing = oldEvents ?? [];
          const existingIds = new Set(existing.map((e) => e.id));
          const newEvents = events.filter((e) => !existingIds.has(e.id));
          return [...existing, ...newEvents];
        },
        eventsDbStore,
      );
      set((old) => ({ eventFetchCount: old.eventFetchCount + 1 }));
    },

    exportEvents: async () => {
      const deviceId = getStore().deviceId;
      if (!deviceId) {
        return [];
      }
      return (await get<DataSourceEvent[]>(deviceId, eventsDbStore)) ?? [];
    },
  }));
}

export default function EventsProvider({ children }: { children?: ReactNode }): React.JSX.Element {
  const [store] = useState(createEventsStore);
  const [sourceEvents, setSourceEvents] = useState<DataSourceEvent[]>([]);

  const startTime = useMessagePipeline(selectStartTime);
  const endTime = useMessagePipeline(selectEndTime);
  const playerName = useMessagePipeline(selectPlayerName);

  // Sync deviceId from player name
  useEffect(() => {
    if (playerName !== store.getState().deviceId) {
      store.getState().setDeviceId(playerName);
    }
  }, [playerName, store]);

  // Fetch events from IndexedDB
  useEffect(() => {
    let lastFetchCount = store.getState().eventFetchCount;
    let lastDeviceId = store.getState().deviceId;

    const fetchEvents = async () => {
      const deviceId = store.getState().deviceId;
      if (!deviceId) {
        setSourceEvents([]);
        return;
      }

      store.setState({ events: { loading: true } });
      try {
        const storedEvents = (await get<DataSourceEvent[]>(deviceId, eventsDbStore)) ?? [];
        setSourceEvents(storedEvents);
      } catch (err) {
        log.error(err);
        store.setState({ events: { loading: false, error: err as Error } });
      }
    };

    const unsub = store.subscribe((state) => {
      if (state.eventFetchCount !== lastFetchCount || state.deviceId !== lastDeviceId) {
        lastFetchCount = state.eventFetchCount;
        lastDeviceId = state.deviceId;
        void fetchEvents();
      }
    });

    void fetchEvents();
    return unsub;
  }, [store]);

  // Map events to timeline positions when source events or timeline bounds change
  useEffect(() => {
    const totalDuration = startTime && endTime ? toSec(subtract(endTime, startTime)) : undefined;

    const timelineEvents: TimelinePositionedEvent[] = sourceEvents.map((event) => {
      let startPosition = 0;
      let endPosition = 0;

      if (startTime && totalDuration != undefined && totalDuration > 0) {
        const startOffset = toSec(subtract(event.startTime, startTime));
        const endOffset = toSec(subtract(event.endTime, startTime));
        startPosition = startOffset / totalDuration;
        endPosition = endOffset / totalDuration;
      }
      return {
        event,
        startPosition,
        endPosition,
        secondsSinceStart: event.startTimeInSeconds,
      };
    });

    store.setState({ events: { loading: false, value: timelineEvents } });
  }, [sourceEvents, startTime, endTime, store]);

  return <EventsContext.Provider value={store}>{children}</EventsContext.Provider>;
}
