import bcrypt from 'bcrypt'
import { query } from '../src/utils/database.js'
import { logger } from '../src/utils/logger.js'

async function createAdmin() {
  const email = process.env.ADMIN_EMAIL || 'admin@aegis.local'
  const password = process.env.ADMIN_PASSWORD || 'changeme123!'
  const firstName = process.env.ADMIN_FIRST_NAME || 'System'
  const lastName = process.env.ADMIN_LAST_NAME || 'Administrator'
  
  try {
    const passwordHash = await bcrypt.hash(password, 12)
    
    const result = await query(`
      INSERT INTO users (email, password_hash, first_name, last_name, role, is_active)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (email) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, email, role
    `, [email, passwordHash, firstName, lastName, 'admin', true])
    
    logger.info('Admin user created/updated:', result.rows[0])
    
    console.log('\n🎉 Admin user ready!')
    console.log(`📧 Email: ${email}`)
    console.log(`🔐 Password: ${password}`)
    console.log('⚠️  Please change the password after first login\n')
    
  } catch (error) {
    logger.error('Error creating admin user:', error)
    throw error
  }
  
  process.exit(0)
}

createAdmin().catch(console.error)