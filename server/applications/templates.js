import { normalizeText } from '../radar/text.js'

const ROLE_RULES = [
  {
    type: 'po',
    label: 'Product Owner',
    terms: ['product owner', 'proxy po', 'proxy product owner', ' po '],
    angle: 'Je peux contribuer au cadrage, à la priorisation du backlog et à la coordination entre équipes métier et techniques.',
  },
  {
    type: 'ba',
    label: 'Business Analyst',
    terms: ['business analyst', ' ba '],
    angle: 'Je peux aider à formaliser les besoins métier, sécuriser les spécifications et fluidifier les échanges avec les équipes produit et IT.',
  },
  {
    type: 'moa',
    label: 'Chef de projet MOA / AMOA',
    terms: ['chef de projet moa', 'chef de projet amoa', 'consultant moa', 'consultant amoa', ' moa ', ' amoa '],
    angle: 'Je peux apporter une approche structurée de pilotage, de cadrage métier et de coordination projet.',
  },
  {
    type: 'delivery',
    label: 'Delivery',
    terms: ['delivery', 'release train', 'pilotage delivery'],
    angle: 'Je peux contribuer au suivi d’exécution, à la coordination des parties prenantes et à la sécurisation des livrables.',
  },
  {
    type: 'discovery',
    label: 'Discovery',
    terms: ['discovery', 'user research', 'cadrage produit', 'atelier utilisateur'],
    angle: 'Je peux contribuer aux phases de cadrage, d’analyse utilisateur et de transformation des besoins en priorités actionnables.',
  },
  {
    type: 'funeral',
    label: 'Métiers funéraires',
    terms: ['conseiller funeraire', 'assistante funeraire', 'assistant funeraire', 'funeraire', 'pompes funebres'],
    angle: 'Je peux apporter une posture sérieuse, organisée et attentive dans l’accompagnement des familles et le suivi administratif.',
  },
]

const TRANSVERSE = {
  type: 'transverse',
  label: 'Transverse',
  angle: 'Je peux contribuer avec une approche structurée, orientée coordination, qualité d’exécution et compréhension métier.',
}

export function classifyApplicationType(offer = {}) {
  const text = ` ${normalizeText([offer.title, offer.description].join(' '))} `
  return ROLE_RULES.find((rule) => rule.terms.some((term) => text.includes(term))) || TRANSVERSE
}

export function renderApplicationTemplate({ offer, context, offerUrl }) {
  const title = String(offer.title || '').trim() || 'poste proposé'
  const role = classifyApplicationType(offer)
  const signature = [context.applicationMail.firstName, context.applicationMail.lastName].filter(Boolean).join(' ').trim()
  const data = {
    title,
    offerUrl,
    roleLabel: role.label,
    angle: role.angle,
    firstName: context.applicationMail.firstName || '',
    lastName: context.applicationMail.lastName || '',
    signature,
    phone: context.applicationMail.phone || '',
  }

  const template = context.applicationMail.dynamicTemplate || {}
  const subjectTemplate = template.subject || 'Candidature : [Intitulé du poste]'
  const bodyTemplate = template.body || defaultBodyTemplate()
  return {
    subject: renderPlaceholders(subjectTemplate, data),
    text: renderPlaceholders(bodyTemplate, data),
    roleType: role.type,
    angle: role.angle,
  }
}

function defaultBodyTemplate() {
  return `Bonjour,

Je vous adresse ma candidature pour le poste de [Intitulé du poste].

Offre concernée : [URL de l’offre]

[Angle candidature]

Vous trouverez mon CV en pièce jointe. Je suis disponible pour échanger par téléphone afin de vous présenter mon profil.

Vous pouvez me joindre au [Téléphone].

Bien cordialement,
[Prénom Nom]`
}

function renderPlaceholders(template, data) {
  return String(template || '')
    .replaceAll('[Intitulé du poste]', data.title)
    .replaceAll('[URL de l’offre]', data.offerUrl || '')
    .replaceAll('[Type métier]', data.roleLabel)
    .replaceAll('[Angle candidature]', data.angle)
    .replaceAll('[Prénom]', data.firstName)
    .replaceAll('[Nom]', data.lastName)
    .replaceAll('[Prénom Nom]', data.signature)
    .replaceAll('[Téléphone]', data.phone)
}
