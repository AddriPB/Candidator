import 'dotenv/config'
import { buildEsnDiscoveryOffers, buildWebDiscoveryOffers, discoverContactsForOffer, discoverEsnRecruiterContacts, discoverWebRecruiterContacts } from '../applications/contactDiscovery.js'
import { applicationOfferKey } from '../applications/emailer.js'
import { loadRadarConfig } from '../radar/config.js'
import { getApplicationCandidateOffers, openDatabase, upsertApplicationContacts } from '../storage/database.js'

const db = openDatabase()

try {
  const config = loadRadarConfig()
  const source = getApplicationCandidateOffers(db)
  let contactsCount = 0
  for (const offer of source.offers) {
    const offerKey = applicationOfferKey(offer)
    const contacts = await discoverContactsForOffer(offer, { offerKey })
    upsertApplicationContacts(db, contacts)
    contactsCount += contacts.length
  }
  const esnOffers = buildEsnDiscoveryOffers(config.esn_contact_discovery)
  const esnContacts = await discoverEsnRecruiterContacts(config)
  upsertApplicationContacts(db, esnContacts)
  contactsCount += esnContacts.length
  const webOffers = buildWebDiscoveryOffers(config.web_contact_discovery)
  const webContacts = await discoverWebRecruiterContacts(config)
  upsertApplicationContacts(db, webContacts)
  contactsCount += webContacts.length

  console.log(`[applications] offers scanned: ${source.offers.length}`)
  console.log(`[applications] esn companies scanned: ${esnOffers.length}`)
  console.log(`[applications] web queries scanned: ${webOffers.length}`)
  console.log(`[applications] contacts found: ${contactsCount}`)
} catch (error) {
  console.error(`[applications] contact discovery failed: ${error.stack || error.message}`)
  process.exitCode = 1
}
