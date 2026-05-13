import 'dotenv/config'
import { openDatabase, pruneOldData } from '../storage/database.js'

const db = openDatabase()
const result = pruneOldData(db)
console.log(JSON.stringify(result, null, 2))
db.close()
