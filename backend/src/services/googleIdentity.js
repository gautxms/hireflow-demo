import { OAuth2Client } from 'google-auth-library'

const client = new OAuth2Client()

// Kept behind a method so route tests can replace the network verifier.
export const googleIdentity = {
  async verify(credential) {
    const audience = process.env.GOOGLE_CLIENT_ID
    if (!audience) throw new Error('Google auth is not configured')
    const ticket = await client.verifyIdToken({ idToken: credential, audience })
    const claims = ticket.getPayload()
    if (!claims?.sub || !claims?.email || claims.email_verified !== true) {
      throw new Error('Google account email is not verified')
    }
    return { subject: claims.sub, email: claims.email.trim().toLowerCase() }
  },
}
