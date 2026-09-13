import type { ScamScript } from "./types";

export const DIGITAL_ARREST: ScamScript = {
  key: "digital_arrest",
  name: "Digital Arrest (authority impersonation)",
  summary:
    "Caller impersonates police / CBI / ED / customs / RBI and holds the victim on a video or phone call, claiming a serious case, demanding secrecy, and forcing transfers to 'verify' funds.",
  stages: [
    {
      id: "pretext_authority",
      name: "Authority pretext",
      description: "Caller claims to be police, CBI, ED, customs, TRAI, RBI or a courier/government official.",
      indicators: ["CBI", "police", "customs", "narcotics", "Aadhaar misuse", "parcel", "case registered", "officer badge"]
    },
    {
      id: "accusation",
      name: "False accusation",
      description: "Claims the victim's ID, number or account is linked to a crime such as money laundering or a drug parcel.",
      indicators: ["money laundering", "illegal parcel", "your name is in the case", "arrest warrant", "non-bailable"]
    },
    {
      id: "isolation",
      name: "Isolation & secrecy",
      description: "Orders the victim to tell no one, stay on the call, and avoid police or family.",
      indicators: ["don't tell anyone", "keep this confidential", "stay on the call", "don't call police", "family will be arrested"]
    },
    {
      id: "surveillance",
      name: "Video surveillance",
      description: "Demands a continuous video call or 'digital custody' to monitor the victim.",
      indicators: ["video call", "stay on camera", "digital arrest", "do not disconnect", "share your screen"]
    },
    {
      id: "verification_demand",
      name: "Fund verification demand",
      description: "Asks the victim to move money to a 'verification' or 'safe custody' account, or share OTP/PIN.",
      indicators: ["verification account", "safe account", "RBI account", "share OTP", "refund", "secret supervision account"]
    },
    {
      id: "extraction",
      name: "Extraction",
      description: "Directs RTGS/IMPS/UPI transfers, often multiple transactions, loans or fixed-deposit liquidation.",
      indicators: ["transfer now", "RTGS", "IMPS", "UPI", "break your FD", "take a loan", "gold"]
    },
    {
      id: "closure_threat",
      name: "Closure threat",
      description: "Threatens arrest, property seizure or harm if the victim stops complying or reports.",
      indicators: ["warrant issued", "property seize", "jail", "you will be arrested tonight"]
    }
  ],
  paymentMethods: ["RTGS", "IMPS", "UPI", "bank transfer to mule accounts", "crypto"],
  sourceNote:
    "Derived from public reporting: MHA/I4C data, Supreme Court suo motu proceedings (2025-2026), CBI Operation Chakra-V/VI releases, NHRC open house (June 2026), news reporting of individual cases."
};

export const VOICE_CLONE_EMERGENCY: ScamScript = {
  key: "voice_clone_emergency",
  name: "Voice-clone family emergency",
  summary:
    "A cloned voice of a family member claims an accident, arrest or kidnapping and demands an urgent, secret UPI/QR payment from an unknown number.",
  stages: [
    {
      id: "trusted_voice_contact",
      name: "Familiar voice contact",
      description: "Caller sounds exactly like a child, sibling or cousin but calls from an unknown number.",
      indicators: ["it's me", "mom", "papa", "unknown number", "voice matches family"]
    },
    {
      id: "emergency_claim",
      name: "Emergency claim",
      description: "Claims an accident, hospital admission, kidnapping or police custody.",
      indicators: ["accident", "hospital", "kidnapped", "arrested", "surgery"]
    },
    {
      id: "urgency_pressure",
      name: "Extreme urgency",
      description: "Insists money is needed within minutes and prevents verification.",
      indicators: ["right now", "in ten minutes", "no time", "before it is too late"]
    },
    {
      id: "secrecy_isolation",
      name: "Secrecy",
      description: "Tells the victim not to inform other family members or call back.",
      indicators: ["don't tell papa", "don't call anyone", "phone is broken", "stay on the line"]
    },
    {
      id: "payment_demand",
      name: "Instant payment demand",
      description: "Sends a UPI ID or QR code and demands an immediate transfer.",
      indicators: ["scan this QR", "UPI", "send money", "transfer to this account", "Google Pay"]
    }
  ],
  paymentMethods: ["UPI", "QR code", "IMPS"],
  sourceNote: "Derived from public advisories and 2025-2026 reporting on AI voice-cloning fraud in India."
};

export const KYC_BANK_FRAUD: ScamScript = {
  key: "kyc_bank_fraud",
  name: "Bank / KYC impersonation",
  summary:
    "Caller pretends to be from the victim's bank, warns of a blocked account or expiring KYC, and harvests OTPs, PINs or remote access.",
  stages: [
    {
      id: "institution_impersonation",
      name: "Institution impersonation",
      description: "Claims to be from the bank, card network or a payment app.",
      indicators: ["bank", "SBI", "HDFC", "card department", "helpline", "RBI"]
    },
    {
      id: "account_threat",
      name: "Account threat",
      description: "Claims the account will be blocked, KYC expired, or a suspicious transaction occurred.",
      indicators: ["account blocked", "KYC expired", "suspicious transaction", "card will be frozen"]
    },
    {
      id: "trust_building",
      name: "Trust building",
      description: "Shares partial real details to sound legitimate.",
      indicators: ["last four digits", "registered mobile", "branch name", "policy number"]
    },
    {
      id: "credential_request",
      name: "Credential request",
      description: "Asks for OTP, PIN, CVV or a link to be clicked.",
      indicators: ["OTP", "PIN", "CVV", "click this link", "confirm password"]
    },
    {
      id: "remote_access",
      name: "Remote access",
      description: "Asks the victim to install AnyDesk, TeamViewer or a 'support' app.",
      indicators: ["AnyDesk", "TeamViewer", "screen share", "install this app"]
    },
    {
      id: "extraction",
      name: "Extraction",
      description: "Drains the account or opens loans while the victim watches.",
      indicators: ["transfer", "debit", "loan approved", "beneficiary added"]
    }
  ],
  paymentMethods: ["OTP-authorized transfers", "UPI", "remote-access banking"],
  sourceNote: "Derived from bank and RBI public advisories and cybercrime reporting."
};

export const TECH_SUPPORT: ScamScript = {
  key: "tech_support",
  name: "Tech-support scam",
  summary:
    "Caller claims the victim's device is infected or a refund is due, then takes remote access and charges the victim.",
  stages: [
    {
      id: "authority_impersonation",
      name: "Brand impersonation",
      description: "Claims to be Microsoft, Apple, Amazon or a bank's technical team.",
      indicators: ["Microsoft", "Apple", "Amazon", "technical department", "security alert"]
    },
    {
      id: "threat",
      name: "Threat",
      description: "Claims a virus, hack or failed transaction requiring urgent action.",
      indicators: ["virus", "hacked", "failed transaction", "your computer is infected"]
    },
    {
      id: "remote_access",
      name: "Remote access",
      description: "Asks the victim to install a remote desktop tool.",
      indicators: ["AnyDesk", "TeamViewer", "download this tool", "give me control"]
    },
    {
      id: "payment_request",
      name: "Payment request",
      description: "Demands gift cards, UPI or bank transfer for 'support' or 'refund processing'.",
      indicators: ["gift card", "UPI", "pay the fee", "processing charge"]
    }
  ],
  paymentMethods: ["gift cards", "UPI", "bank transfer"],
  sourceNote: "Derived from consumer-protection advisories (Jio, Microsoft, cyber cells)."
};

export const LOTTERY_PRIZE: ScamScript = {
  key: "lottery_prize",
  name: "Lottery / prize / scheme fraud",
  summary:
    "Caller claims a lottery, government scheme payment or prize, then demands a processing fee and personal details.",
  stages: [
    {
      id: "lucky_claim",
      name: "Lucky claim",
      description: "Claims the victim has won a lottery, KBC prize or government scheme benefit.",
      indicators: ["lottery", "KBC", "prize", "lucky draw", "PM scheme", "subsidy"]
    },
    {
      id: "fee_request",
      name: "Advance fee",
      description: "Demands a processing fee, tax or deposit before 'releasing' the money.",
      indicators: ["processing fee", "token amount", "advance tax", "deposit first"]
    },
    {
      id: "data_request",
      name: "Data harvesting",
      description: "Asks for Aadhaar, PAN, bank account or OTP details.",
      indicators: ["Aadhaar number", "PAN", "bank details", "OTP"]
    },
    {
      id: "urgency",
      name: "Urgency",
      description: "Pressures the victim to pay before the offer expires.",
      indicators: ["last date", "offer expires", "today only"]
    }
  ],
  paymentMethods: ["UPI", "bank transfer", "gift cards"],
  sourceNote: "Derived from public cyber-fraud advisories."
};

export const BENIGN_CALLS: Array<{ key: string; name: string; transcript: string[] }> = [
  {
    key: "family_checkin",
    name: "Family check-in call",
    transcript: [
      "Beta, I reached home safely. Have you had lunch?",
      "Yes Mummy. Did you take your BP tablet today?",
      "Yes yes, I did. Your cousin's wedding is on Sunday, should I book the train?",
      "Please book it in the morning, and send me the PNR when you do."
    ]
  },
  {
    key: "hospital_appointment",
    name: "Hospital appointment reminder",
    transcript: [
      "Hello, this is Dr. Rao's clinic calling to confirm your appointment.",
      "Yes, tomorrow at eleven for my father's checkup.",
      "Please bring your previous reports and the insurance card.",
      "We will be there by ten thirty. Thank you for the reminder."
    ]
  },
  {
    key: "bank_legit",
    name: "Legitimate bank callback",
    transcript: [
      "Good afternoon, I'm calling from the branch regarding your fixed deposit maturity.",
      "Yes, I wanted to renew it for one more year.",
      "You can renew it through the app or visit us with your passbook.",
      "I will come to the branch on Friday morning."
    ]
  }
];

export const GENOME_SEED: ScamScript[] = [
  DIGITAL_ARREST,
  VOICE_CLONE_EMERGENCY,
  KYC_BANK_FRAUD,
  TECH_SUPPORT,
  LOTTERY_PRIZE
];

export function scriptByKey(key?: string): ScamScript | undefined {
  return GENOME_SEED.find((s) => s.key === key);
}
