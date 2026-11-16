#!/usr/bin/env node
const { performance } = require('node:perf_hooks')

const REQUEST_COUNT = 10
const MAX_RETRIES = 5
const RETRY_BASE_DELAY_MS = 1_000
const BYTES_IN_MB = 1_000_000
const TIMEOUT_MS = 30_000

const shouldRetry = (error) => {
  if (error.statusCode !== undefined) {
    return error.statusCode === 408 || error.statusCode === 429 || error.statusCode >= 500
  }

  return true
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const downloadOnce = async (url) => {
  const startedAt = performance.now()

  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  let bytes = 0

  if (response.body) {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength
    }
  }

  const durationMs = performance.now() - startedAt

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} ${response.statusText}`)
    error.statusCode = response.status
    throw error
  }

  return { durationMs, bytes }
}

const download = async (url, requestNumber) => {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const result = await downloadOnce(url)
      const retryLabel = attempt > 0 ? ` (успех после ${attempt} повт.)` : ''

      console.log(`Запрос ${requestNumber}/${REQUEST_COUNT}: ${(result.durationMs / 1000).toFixed(2)} с, ${(result.bytes / BYTES_IN_MB).toFixed(3)} МБ${retryLabel}`)

      return result
    } catch (error) {
      const isLastAttempt = attempt === MAX_RETRIES

      if (isLastAttempt || !shouldRetry(error)) {
        throw new Error(
          `Запрос ${requestNumber}/${REQUEST_COUNT}: ${error.message}` +
          (isLastAttempt && attempt > 0 ? ` (исчерпаны ${MAX_RETRIES} повтора)` : ''), { cause: error }
        )
      }

      const delayMs = RETRY_BASE_DELAY_MS * (2 ** attempt)

      console.warn(`Запрос ${requestNumber}/${REQUEST_COUNT}: ${error.message}. Повтор ${attempt + 1}/${MAX_RETRIES} через ${delayMs / 1000} с...`)

      await sleep(delayMs)
    }
  }
}

async function main() {
  const input = process.argv[2]

  if (!input) {
    console.error('Использование: node index.js <URL>')
    process.exit(1)
  }

  let url

  try {
    url = new URL(input)

    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Поддерживаются только HTTP и HTTPS.')
    }
  } catch (error) {
    console.error(`Некорректный URL: ${error.message}`)
    process.exit(1)
  }

  console.log(`Проверка скорости загрузки: ${url.href}`)
  console.log(`Количество запросов: ${REQUEST_COUNT}`)
  console.log(`Повторов на запрос: до ${MAX_RETRIES}\n`)

  const totalStartedAt = performance.now()
  const results = []

  try {
    for (let i = 1; i <= REQUEST_COUNT; i += 1) {
      results.push(await download(url, i))
    }
  } catch (error) {
    console.error(`\nОшибка: ${error.message}`)
    process.exit(1)
  }

  const totalDurationMs = performance.now() - totalStartedAt
  const totalBytes = results.reduce((sum, result) => sum + result.bytes, 0)
  const averageRequestMs = results.reduce((sum, result) => sum + result.durationMs, 0) / results.length
  const totalMegabytes = totalBytes / BYTES_IN_MB
  const averageSpeedMBps = totalMegabytes / (totalDurationMs / 1000)

  console.log('\n--- Результат ---')
  console.log(`Успешных запросов: ${results.length}/${REQUEST_COUNT}`)
  console.log(`Среднее время запроса: ${(averageRequestMs / 1000).toFixed(2)} с`)
  console.log(`Объём скачанных данных: ${totalMegabytes.toFixed(3)} МБ`)
  console.log(`Общее время: ${(totalDurationMs / 1000).toFixed(2)} с`)
  console.log(`Средняя скорость скачивания: ${averageSpeedMBps.toFixed(2)} МБ/с`)
}

main()
