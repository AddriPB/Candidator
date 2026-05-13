import 'dotenv/config'
import { ensureDefaultSettings } from '../settings/index.js'
import { getDatabasePath, openDatabase } from '../storage/database.js'

const db = openDatabase()
ensureDefaultSettings(db)
console.log(`SQLite ready: ${getDatabasePath()}`)
db.close()
