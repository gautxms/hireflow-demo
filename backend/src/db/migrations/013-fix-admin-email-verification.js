export async function up(client) {
  // Mark all admin users as email-verified
  await client.query(`
    UPDATE users SET email_verified = true WHERE is_admin = true;
  `)

  console.log('[Migration] Admin email verification fixed')
}
