// Shared shape for community-sourced creature entries in entity-registry.json.
// All registry entries with source: 'community' must include an attribution block
// that conforms to this interface — enforced here so the contract is one place.

/** Attribution metadata stored per community entry in entity-registry.json. */
export interface CommunityAttribution {
  /** UUID from creature_submissions.id */
  creature_submission_id: string;
  /** Creator's display name — present only when creature_submissions.credits_opt_in = true. */
  maker_name?: string;
}

/** The source + attribution fragment added to every community registry entry. */
export interface CommunityRegistryFields {
  source: 'community';
  attribution: CommunityAttribution;
}

/**
 * Build the source/attribution block for a community creature registry entry.
 *
 * @param submissionId  - creature_submissions.id (UUID)
 * @param creatorName   - creature_submissions.creator_name
 * @param creditsOptIn  - creature_submissions.credits_opt_in; controls whether
 *                        maker_name appears in the registry (and later in-game credits)
 */
export function buildCommunityAttribution(
  submissionId: string,
  creatorName: string | null,
  creditsOptIn: boolean,
): CommunityRegistryFields {
  const attribution: CommunityAttribution = { creature_submission_id: submissionId };
  if (creditsOptIn && creatorName) {
    attribution.maker_name = creatorName;
  }
  return { source: 'community', attribution };
}
