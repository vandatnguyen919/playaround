package app.keylab.sound.uploads;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Signs upload URLs the way an object store presigns them: HMAC-SHA256 over
 * the upload id and the expiry, so the URL alone allows one PUT of one file
 * until it expires. With no key configured, a random one is made at start,
 * which is fine for one instance (tickets live 15 minutes).
 */
@Component
public class UploadSigner {

    private static final Logger log = LoggerFactory.getLogger(UploadSigner.class);

    private final byte[] key;

    UploadSigner(@Value("${keylab.storage.signing-key:}") String configured) {
        if (configured == null || configured.isBlank()) {
            byte[] random = new byte[32];
            new SecureRandom().nextBytes(random);
            this.key = random;
            log.info("No keylab.storage.signing-key set; upload URLs are signed with a random key until restart");
        }
        else {
            this.key = configured.getBytes(StandardCharsets.UTF_8);
        }
    }

    public String sign(UUID uploadId, Instant expiresAt) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            byte[] digest = mac.doFinal((uploadId + ":" + expiresAt.getEpochSecond()).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        }
        catch (GeneralSecurityException ex) {
            throw new IllegalStateException(ex);
        }
    }

    /** Constant-time check of a signature from a URL. */
    public boolean verify(UUID uploadId, Instant expiresAt, String signature) {
        if (signature == null) {
            return false;
        }
        return MessageDigest.isEqual(sign(uploadId, expiresAt).getBytes(StandardCharsets.US_ASCII),
                signature.getBytes(StandardCharsets.US_ASCII));
    }
}
