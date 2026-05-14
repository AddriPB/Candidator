import 'dotenv/config'
import { discoverContactsForOffer } from '../applications/contactDiscovery.js'
import { applicationOfferKey } from '../applications/emailer.js'
import { getApplicationCandidateOffers, openDatabase, upsertApplicationContacts } from '../storage/database.js'

const db = openDatabase()

try {
  const source = getApplicationCandidateOffers(db)
  let contactsCount = 0
  for (const offer of source.offers) {
    const offerKey = applicationOfferKey(offer)
    const contacts = await discoverContactsForOffer(offer, { offerKey })
    upsertApplicationContacts(db, contacts)
    contactsCount += contacts.length
  }
  console.log(`[applications] offers scanned: ${source.offers.length}`)
  console.log(`[applications] contacts found: ${contactsCount}`)
} catch (error) {
  console.error(`[applications] contact discovery failed: ${error.stack || error.message}`)
  process.exitCode = 1
}
