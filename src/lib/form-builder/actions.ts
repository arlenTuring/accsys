'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import * as builder from '@/lib/form-builder/service';

// Thin wrappers: the actor always comes from the server-side session. Every
// rule (admin, recent login, rate limit, row version) lives in service.ts.

async function done<T extends { ok: boolean }>(result: T, live = false): Promise<T> {
  if (result.ok) {
    revalidatePath('/admin/form-builder', 'layout');
    // Menus, /forms and the dashboard list published forms.
    if (live) revalidatePath('/', 'layout');
  }
  return result;
}

const me = () => getCurrentEmployee();

export async function createDefinitionAction(input: unknown) {
  return done(await builder.createDefinition(await me(), input));
}

export async function saveDraftAction(id: string, input: unknown, expectedVersion: number) {
  return done(await builder.saveDraft(await me(), id, input, expectedVersion));
}

export async function discardDraftAction(id: string, expectedVersion: number) {
  return done(await builder.discardDraft(await me(), id, expectedVersion));
}

export async function saveSettingsAction(id: string, input: unknown, expectedVersion: number) {
  return done(await builder.saveSettings(await me(), id, input, expectedVersion), true);
}

export async function publishDraftAction(id: string, expectedVersion: number) {
  return done(await builder.publishDraft(await me(), id, expectedVersion), true);
}

export async function setArchivedAction(id: string, archived: boolean, expectedVersion: number) {
  return done(await builder.setArchived(await me(), id, archived === true, expectedVersion), true);
}

export async function deleteDraftDefinitionAction(id: string, expectedVersion: number) {
  return done(await builder.deleteDraftDefinition(await me(), id, expectedVersion));
}

export async function simulateDraftAction(input: unknown) {
  return builder.simulateDraft(await me(), input);
}
