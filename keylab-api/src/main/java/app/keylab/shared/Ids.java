package app.keylab.shared;

import java.security.SecureRandom;
import java.util.UUID;

/**
 * UUIDv7 (RFC 9562) for private records (api-design-v1.md, Conventions, IDs):
 * a 48-bit millisecond timestamp first, so new rows sort by time and land
 * together in the index, then random bits.
 */
public final class Ids {

    private static final SecureRandom RANDOM = new SecureRandom();

    private Ids() {
    }

    public static UUID uuidV7() {
        return uuidV7(System.currentTimeMillis());
    }

    static UUID uuidV7(long epochMillis) {
        byte[] random = new byte[10];
        RANDOM.nextBytes(random);
        long high = (epochMillis & 0xFFFF_FFFF_FFFFL) << 16;
        high |= 0x7000L; // version 7
        high |= ((random[0] & 0x0FL) << 8) | (random[1] & 0xFFL);
        long low = 0;
        for (int i = 2; i < 10; i++) {
            low = (low << 8) | (random[i] & 0xFFL);
        }
        low = (low & 0x3FFF_FFFF_FFFF_FFFFL) | 0x8000_0000_0000_0000L; // variant 10
        return new UUID(high, low);
    }
}
