export interface VoiceReadiness {
  photonLine: boolean;
  photonResource: boolean;
  inboundDestination: boolean;
  outboundCredentials: boolean;
  elevenLabsAgent: boolean;
  ready: boolean;
}

export function getVoiceReadiness(): VoiceReadiness {
  const readiness: VoiceReadiness = {
    photonLine: Boolean(process.env.PHOTON_PHONE_NUMBER),
    photonResource: Boolean(process.env.PHOTON_RESOURCE_ID),
    inboundDestination: Boolean(process.env.PHOTON_SIP_INBOUND_ADDRESS),
    outboundCredentials: Boolean(process.env.PHOTON_SIP_ADDRESS && process.env.PHOTON_SIP_USERNAME && process.env.PHOTON_SIP_PASSWORD),
    elevenLabsAgent: Boolean(process.env.ELEVENLABS_AGENT_ID),
    ready: false
  };
  readiness.ready = Object.entries(readiness)
    .filter(([key]) => key !== "ready")
    .every(([, value]) => value === true);
  return readiness;
}