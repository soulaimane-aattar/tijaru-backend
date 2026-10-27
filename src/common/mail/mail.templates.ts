export type Mail = { subject: string; html: string; text: string };

type Content = {
  subject: string;
  /** Inbox preview line. */
  preheader: string;
  heading: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
};

const BRAND = '#0F766E';
const ACCENT = '#F97316';

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const date = (d: Date): string => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** One layout for every email: table-based, inline CSS (mail-client safe), 600px, with a plain-text twin. */
function render(c: Content): Mail {
  const paragraphs = c.paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#334155;">${p}</p>`)
    .join('');
  const button = c.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 8px;"><tr><td style="background:${BRAND};border-radius:10px;"><a href="${esc(c.cta.url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">${esc(c.cta.label)}</a></td></tr></table>`
    : '';

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(c.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td style="padding:24px 32px;border-bottom:3px solid ${ACCENT};font-size:22px;font-weight:800;color:${BRAND};">Tijaru</td></tr>
<tr><td style="padding:32px;">
<h1 style="margin:0 0 20px;font-size:22px;line-height:28px;color:#0f172a;">${c.heading}</h1>
${paragraphs}${button}
</td></tr>
<tr><td style="padding:20px 32px;background:#f8fafc;font-size:12px;line-height:18px;color:#94a3b8;">Cet e-mail est envoyé automatiquement par Tijaru, merci de ne pas y répondre.</td></tr>
</table></td></tr></table></body></html>`;

  const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const text = [strip(c.heading), '', ...c.paragraphs.map(strip), ...(c.cta ? ['', `${c.cta.label} : ${c.cta.url}`] : []), '', '—', 'Tijaru · e-mail automatique, merci de ne pas répondre.'].join('\n');

  return { subject: c.subject, html, text };
}

type Who = { ownerName: string; businessName: string };

export const registrationReceived = ({ ownerName, businessName }: Who): Mail =>
  render({
    subject: 'Votre demande a bien été reçue',
    preheader: `Nous examinons la demande de ${businessName}.`,
    heading: `Bonjour ${esc(ownerName)},`,
    paragraphs: [
      `Nous avons bien reçu la demande d'inscription de <strong>${esc(businessName)}</strong>.`,
      'Notre équipe l’examine et vous recevrez un e-mail dès qu’elle sera validée. Vous ne pourrez vous connecter qu’à ce moment-là.',
    ],
  });

export const businessApproved = ({ ownerName, businessName }: Who, appUrl: string): Mail =>
  render({
    subject: 'Votre demande est acceptée — bienvenue sur Tijaru',
    preheader: `${businessName} est prêt : connectez-vous.`,
    heading: `Bonne nouvelle ${esc(ownerName)} !`,
    paragraphs: [
      `La demande de <strong>${esc(businessName)}</strong> a été <strong>acceptée</strong>. Votre espace est prêt : stock, caisse, clients, factures et dépenses.`,
      'Connectez-vous avec l’adresse e-mail et le mot de passe choisis à l’inscription.',
    ],
    cta: { label: 'Se connecter', url: `${appUrl}/login` },
  });

export const businessRejected = ({ ownerName, businessName }: Who): Mail =>
  render({
    subject: 'Votre demande n’a pas pu être validée',
    preheader: `Réponse concernant ${businessName}.`,
    heading: `Bonjour ${esc(ownerName)},`,
    paragraphs: [
      `Nous ne pouvons pas valider pour le moment la demande de <strong>${esc(businessName)}</strong>.`,
      'Si vous pensez qu’il s’agit d’une erreur, contactez-nous depuis tijaru.com et nous reverrons votre dossier.',
    ],
  });

export const subscriptionExpiring = (
  { ownerName, businessName, daysLeft, endDate }: Who & { daysLeft: number; endDate: Date },
  appUrl: string,
): Mail =>
  render({
    subject: daysLeft === 1 ? 'Votre abonnement expire demain' : `Votre abonnement expire dans ${daysLeft} jours`,
    preheader: `${businessName} : fin le ${date(endDate)}.`,
    heading: `Bonjour ${esc(ownerName)},`,
    paragraphs: [
      `L’abonnement de <strong>${esc(businessName)}</strong> se termine le <strong>${esc(date(endDate))}</strong> (${daysLeft === 1 ? 'demain' : `dans ${daysLeft} jours`}).`,
      'Passé cette date, l’accès à votre espace sera suspendu. Contactez-nous pour le renouveler et continuer sans interruption.',
    ],
    cta: { label: 'Ouvrir Tijaru', url: `${appUrl}/login` },
  });

export const inactivityReminder = ({ ownerName, businessName, days }: Who & { days: number }, appUrl: string): Mail =>
  render({
    subject: 'Votre commerce vous attend sur Tijaru',
    preheader: `Pas de connexion depuis ${days} jours.`,
    heading: `Bonjour ${esc(ownerName)},`,
    paragraphs: [
      `Vous ne vous êtes pas connecté à <strong>${esc(businessName)}</strong> depuis ${days} jours.`,
      'Vos ventes, votre stock et vos factures vous attendent : un point rapide permet de garder des chiffres justes.',
    ],
    cta: { label: 'Retrouver mon commerce', url: `${appUrl}/login` },
  });
