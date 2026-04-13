import net from 'net'

const VIRUSTOTAL_API_URL = 'https://www.virustotal.com/api/v3'
const VIRUSTOTAL_MAX_POLL_ATTEMPTS = 12
const VIRUSTOTAL_POLL_INTERVAL_MS = 2500

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function scanWithVirusTotal(fileBuffer, filename) {
  const apiKey = process.env.VIRUSTOTAL_API_KEY

  if (!apiKey) {
    return {
      provider: 'virustotal',
      status: 'skipped',
      malicious: false,
      details: { reason: 'VIRUSTOTAL_API_KEY is not configured' },
    }
  }

  const formData = new FormData()
  const blob = new Blob([fileBuffer], { type: 'application/octet-stream' })
  formData.append('file', blob, filename)

  const uploadResponse = await fetch(`${VIRUSTOTAL_API_URL}/files`, {
    method: 'POST',
    headers: { 'x-apikey': apiKey },
    body: formData,
  })

  if (!uploadResponse.ok) {
    const payload = await uploadResponse.text().catch(() => '')
    throw new Error(`VirusTotal upload failed (${uploadResponse.status}): ${payload}`)
  }

  const uploadPayload = await uploadResponse.json()
  const analysisId = uploadPayload?.data?.id

  if (!analysisId) {
    throw new Error('VirusTotal response did not include analysis id')
  }

  for (let attempt = 1; attempt <= VIRUSTOTAL_MAX_POLL_ATTEMPTS; attempt += 1) {
    await sleep(VIRUSTOTAL_POLL_INTERVAL_MS)

    const analysisResponse = await fetch(`${VIRUSTOTAL_API_URL}/analyses/${analysisId}`, {
      method: 'GET',
      headers: { 'x-apikey': apiKey },
    })

    if (!analysisResponse.ok) {
      const payload = await analysisResponse.text().catch(() => '')
      throw new Error(`VirusTotal analysis failed (${analysisResponse.status}): ${payload}`)
    }

    const analysisPayload = await analysisResponse.json()
    const analysisStatus = analysisPayload?.data?.attributes?.status

    if (analysisStatus !== 'completed') {
      continue
    }

    const stats = analysisPayload?.data?.attributes?.stats || {}
    const maliciousCount = Number(stats.malicious || 0)

    return {
      provider: 'virustotal',
      status: maliciousCount > 0 ? 'malicious' : 'clean',
      malicious: maliciousCount > 0,
      details: {
        analysisId,
        stats,
      },
    }
  }

  return {
    provider: 'virustotal',
    status: 'timeout',
    malicious: false,
    details: { reason: 'analysis did not complete in time' },
  }
}

function scanWithClamAv(fileBuffer, filename) {
  const host = process.env.CLAMAV_HOST
  const port = Number(process.env.CLAMAV_PORT || 3310)

  if (!host) {
    return Promise.resolve({
      provider: 'clamav',
      status: 'skipped',
      malicious: false,
      details: { reason: 'CLAMAV_HOST is not configured' },
    })
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.write('zINSTREAM\0')

      const chunkSizeBuffer = Buffer.alloc(4)
      chunkSizeBuffer.writeUInt32BE(fileBuffer.length)
      socket.write(chunkSizeBuffer)
      socket.write(fileBuffer)

      const terminator = Buffer.alloc(4)
      terminator.writeUInt32BE(0)
      socket.write(terminator)
    })

    let response = ''

    socket.on('data', (data) => {
      response += data.toString('utf8')
    })

    socket.on('end', () => {
      const found = response.includes('FOUND')
      resolve({
        provider: 'clamav',
        status: found ? 'malicious' : 'clean',
        malicious: found,
        details: {
          filename,
          response: response.trim(),
        },
      })
    })

    socket.on('error', (error) => {
      reject(error)
    })
  })
}

export async function scanFileBuffer(fileBuffer, filename) {
  try {
    const virusTotalResult = await scanWithVirusTotal(fileBuffer, filename)

    if (virusTotalResult.status !== 'skipped') {
      return virusTotalResult
    }

    return await scanWithClamAv(fileBuffer, filename)
  } catch (error) {
    return {
      provider: 'virus_scan',
      status: 'error',
      malicious: false,
      details: { message: error.message },
    }
  }
}

export function isScanResultSafe(scanResult) {
  if (!scanResult || typeof scanResult !== 'object') {
    return false
  }

  if (scanResult.malicious) {
    return false
  }

  return ['clean', 'skipped'].includes(scanResult.status)
}
