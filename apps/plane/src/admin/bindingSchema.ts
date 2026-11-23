import { z } from 'zod'
import { key } from './context.js'

const hex64 = z.string().regex(/^[0-9a-f]{64}$/)
const id26 = z.string().regex(/^[0-9a-z]{26}$/)
const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/)
const workerRef = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}:[a-z0-9][a-z0-9-]{0,62}$/)
const permissions = {
  permissionRead: z.boolean().optional().default(false),
  permissionWrite: z.boolean().optional().default(false),
}

const base = { name: key }

export const bindingRecordSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('VAR'), resourceId: identifier, ...permissions }).strict(),
  z.object({ ...base, type: z.literal('SECRET'), resourceId: identifier, ...permissions }).strict(),
  z.object({ ...base, type: z.literal('KV'), resourceId: identifier, ...permissions }).strict(),
  z
    .object({
      ...base,
      type: z.literal('R2'),
      resourceId: z.string().min(1).max(255),
      ...permissions,
    })
    .strict(),
  z.object({ ...base, type: z.literal('D1'), resourceId: id26, ...permissions }).strict(),
  z
    .object({
      ...base,
      type: z.literal('QUEUE'),
      resourceId: id26,
      deliveryDelaySeconds: z.number().int().min(0).max(86_400).nullable().optional(),
      ...permissions,
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('PG'),
      resourceId: z.string().regex(/^vrtpg:[A-Za-z0-9_.:-]{1,256}$/),
      ...permissions,
    })
    .strict(),
  z
    .object({ ...base, type: z.literal('HYPERDRIVE'), resourceId: identifier, ...permissions })
    .strict(),
  z
    .object({ ...base, type: z.literal('RATELIMIT'), resourceId: identifier, ...permissions })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('SERVICE'),
      resourceId: workerRef,
      entrypoint: z
        .string()
        .regex(/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/)
        .optional(),
      props: z.string().optional(),
      ...permissions,
    })
    .strict(),
  z.object({ ...base, type: z.literal('ASSETS'), resourceId: hex64, ...permissions }).strict(),
  z
    .object({
      ...base,
      type: z.literal('DO'),
      resourceId: z.string().min(3).max(256),
      ...permissions,
    })
    .strict(),
  z.object({ ...base, type: z.literal('WORKER_LOADER'), resourceId: z.literal('loader') }).strict(),
  z
    .object({ ...base, type: z.literal('UNSAFE_EVAL'), resourceId: z.literal('unsafe-eval') })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('ANALYTICS_ENGINE'),
      resourceId: z.string().regex(/^[A-Za-z0-9_]{1,256}$/),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('FLAGSHIP'),
      resourceId: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/),
      ...permissions,
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('K2'),
      resourceId: z.string().regex(/^[0-9a-f]{32}$/),
      ...permissions,
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('SEND_EMAIL'),
      resourceId: z.string().min(1).max(256),
      destinationAddress: z.string().optional(),
      allowedDestinationAddresses: z.array(z.string()).optional(),
      allowedSenderAddresses: z.array(z.string()).optional(),
      ...permissions,
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('IMAGES'),
      resourceId: z.string().optional().default('images'),
      ...permissions,
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('VECTORIZE'),
      resourceId: id26,
      indexName: z.string().min(1).max(64),
      dimensions: z.number().int().min(1).max(1536),
      metric: z.enum(['cosine', 'euclidean', 'dot-product']),
      ...permissions,
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('SECRETS_STORE'),
      resourceId: z.string().min(1).max(256),
      storeId: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
      secretName: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
      ...permissions,
    })
    .strict(),
])

export const bindingsSchema = z.array(bindingRecordSchema).max(64).default([])
