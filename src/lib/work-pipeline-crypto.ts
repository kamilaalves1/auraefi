import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const KDF_SALT = Buffer.from('vertex-work-pipeline-v1', 'utf8')

function deriveKey(): Buffer {
  const secret = (process.env.AUTH_SECRET || '').trim()
  if (!secret) {
    throw new Error('AUTH_SECRET is required to store work pipeline credentials')
  }
  return scryptSync(secret, KDF_SALT, 32)
}

/** Encrypt UTF-8 string; returns base64(iv || tag || ciphertext). */
export function encryptWorkPipelineBlob(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decryptWorkPipelineBlob(blob: string): string {
  const raw = Buffer.from(blob, 'base64')
  if (raw.length < 12 + 16) {
    throw new Error('Invalid encrypted blob')
  }
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const data = raw.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
