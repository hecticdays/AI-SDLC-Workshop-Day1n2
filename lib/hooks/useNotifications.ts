'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Todo } from '@/lib/db';
import { formatSingaporeDate } from '@/lib/timezone';

type NotificationState = NotificationPermission | 'unsupported';
const POLL_INTERVAL_MS = 30_000;

function currentPermission(): NotificationState {
  return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported';
}

export function useNotifications(onError?: (message: string) => void) {
  const [permission, setPermission] = useState<NotificationState>('default');

  useEffect(() => {
    const sync = () => setPermission(currentPermission());
    sync();
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, []);

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) {
      setPermission('unsupported');
      onError?.('This browser does not support notifications.');
      return;
    }
    try {
      setPermission(await Notification.requestPermission());
    } catch {
      onError?.('Notification permission could not be requested.');
    }
  }, [onError]);

  useEffect(() => {
    if (permission !== 'granted') return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch('/api/notifications/check', { cache: 'no-store' });
        if (!response.ok) return;
        const { todos } = await response.json() as { todos: Todo[] };
        if (!active || Notification.permission !== 'granted') return;
        for (const todo of todos) {
          new Notification(todo.title, {
            body: todo.due_date ? `Due ${formatSingaporeDate(todo.due_date, 'd MMM yyyy, h:mm a')}` : 'Reminder',
            tag: `todo-${todo.id}`,
          });
        }
      } catch {
        onError?.('Reminders could not be checked.');
      }
    };
    void poll();
    const interval = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [permission, onError]);

  return { permission, requestPermission };
}
