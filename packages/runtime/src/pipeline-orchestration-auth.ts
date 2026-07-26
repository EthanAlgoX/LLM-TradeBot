import {
  createHash,
  timingSafeEqual,
} from "node:crypto";
import {
  OrchestrationActorSchema,
  type OrchestrationActor,
} from "../../contracts/src/index.js";

export interface PipelineOrchestrationAuthenticator {
  authenticate(authorizationHeader: string | undefined): OrchestrationActor;
}

export interface LocalBearerIdentity {
  token: string;
  actor: OrchestrationActor;
}

export class PipelineAuthenticationError extends Error {
  constructor(
    readonly code:
      | "AUTHORIZATION_REQUIRED"
      | "AUTHORIZATION_SCHEME_INVALID"
      | "AUTHORIZATION_TOKEN_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "PipelineAuthenticationError";
  }
}

function tokenDigest(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export class LocalBearerAuthenticator
  implements PipelineOrchestrationAuthenticator
{
  private readonly identities: readonly {
    digest: Buffer;
    actor: OrchestrationActor;
  }[];

  constructor(identities: readonly LocalBearerIdentity[]) {
    if (identities.length === 0) {
      throw new Error("At least one local bearer identity is required.");
    }
    this.identities = identities.map((identity) => ({
      digest: tokenDigest(identity.token),
      actor: OrchestrationActorSchema.parse(identity.actor),
    }));
  }

  authenticate(authorizationHeader: string | undefined): OrchestrationActor {
    if (!authorizationHeader) {
      throw new PipelineAuthenticationError(
        "AUTHORIZATION_REQUIRED",
        "Bearer authorization is required for this operation.",
      );
    }
    const match = authorizationHeader.match(/^Bearer ([^\s]+)$/);
    if (!match) {
      throw new PipelineAuthenticationError(
        "AUTHORIZATION_SCHEME_INVALID",
        "Authorization must use the Bearer scheme.",
      );
    }
    const suppliedDigest = tokenDigest(match[1]);
    for (const identity of this.identities) {
      if (
        identity.digest.length === suppliedDigest.length &&
        timingSafeEqual(identity.digest, suppliedDigest)
      ) {
        return {
          ...identity.actor,
          roles: [...identity.actor.roles],
        };
      }
    }
    throw new PipelineAuthenticationError(
      "AUTHORIZATION_TOKEN_INVALID",
      "Bearer token is invalid.",
    );
  }
}
