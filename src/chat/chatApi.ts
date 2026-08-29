import { supabase } from '../lib/supabase'
import {
  createChatConversation,
  deleteChatConversation,
  isChatBackendMissing,
  listChatConversations,
  listChatMessages,
  listChatModels,
  renameChatConversation,
  streamChatMessage,
  uploadChatAttachment,
} from '../lib/chatClient'
import type {
  ChatConversation,
  ChatMessage,
  ChatModelsState,
  ChatStreamHandlers,
  ChatStreamOutcome,
  ChatStreamRequest,
} from '../lib/chatClient'
import {
  mockCreateConversation,
  mockDeleteConversation,
  mockListChatModels,
  mockListConversations,
  mockListMessages,
  mockRenameConversation,
  mockStreamChatMessage,
  mockUploadAttachment,
} from './mockChatApi'

/* Один вход для страницы: пока серверной части чата нет, тот же вызов обслуживает демо-сервер.
   Переключение одностороннее — как только сервер ответил «функции нет», остаёмся в демо-режиме. */
let mockMode = supabase === null

export function isChatMockMode() {
  return mockMode
}

async function withFallback<T>(real: () => Promise<T>, mock: () => Promise<T>): Promise<T> {
  if (mockMode) return mock()
  try {
    return await real()
  } catch (error) {
    if (!isChatBackendMissing(error)) throw error
    mockMode = true
    return mock()
  }
}

export function loadChatModels(): Promise<ChatModelsState> {
  return withFallback(listChatModels, mockListChatModels)
}

export function loadChatConversations(): Promise<ChatConversation[]> {
  return withFallback(listChatConversations, mockListConversations)
}

export function loadChatMessages(conversationId: string): Promise<ChatMessage[]> {
  return withFallback(() => listChatMessages(conversationId), () => mockListMessages(conversationId))
}

export function createConversation(title?: string): Promise<ChatConversation> {
  return withFallback(() => createChatConversation(title), () => mockCreateConversation(title))
}

export function renameConversation(conversationId: string, title: string) {
  return withFallback(
    () => renameChatConversation(conversationId, title),
    () => mockRenameConversation(conversationId, title),
  )
}

export function removeConversation(conversationId: string) {
  return withFallback(
    () => deleteChatConversation(conversationId),
    () => mockDeleteConversation(conversationId),
  )
}

export function uploadAttachment(file: File, conversationId: string) {
  return withFallback(
    () => uploadChatAttachment(file, conversationId),
    () => mockUploadAttachment(file, conversationId),
  )
}

export function sendChatMessage(
  request: ChatStreamRequest,
  handlers: ChatStreamHandlers,
  signal: AbortSignal,
): Promise<ChatStreamOutcome> {
  return withFallback(
    () => streamChatMessage(request, handlers, signal),
    () => mockStreamChatMessage(request, handlers, signal),
  )
}
