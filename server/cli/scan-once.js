import 'dotenv/config'
import { runScan } from '../collector/index.js'
import { ensureDefaultSettings } from '../settings/index.js'
import { openDatabase } from '../storage/database.js'

const db = openDatabase()
ensureDefaultSettings(db)
const result = await runScan(db)
console.log(JSON.stringify(result, null, 2))
db.close()
