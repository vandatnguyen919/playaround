package dev.playground.api;

import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.Map;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

/** Mints and tampers with JWTs for the authorization tests. */
final class TestTokens {

    private TestTokens() {
    }

    static RSAKey newKey(String keyId) {
        try {
            return new RSAKeyGenerator(2048).keyID(keyId).generate();
        }
        catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    /** Claims shaped like a Keycloak access token from the gateway client. */
    static JWTClaimsSet.Builder claims(String issuer, String email, List<String> roles, Instant issuedAt, Instant expiresAt) {
        return new JWTClaimsSet.Builder()
            .issuer(issuer)
            .subject("user-" + email)
            .claim("azp", "gateway")
            .claim("typ", "Bearer")
            .claim("email", email)
            .claim("preferred_username", email)
            .claim("name", "Test Person")
            .claim("realm_access", Map.of("roles", roles))
            .issueTime(Date.from(issuedAt))
            .expirationTime(Date.from(expiresAt));
    }

    static String sign(RSAKey key, JWTClaimsSet claims) {
        try {
            SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256)
                .keyID(key.getKeyID()).type(JOSEObjectType.JWT).build(), claims);
            jwt.sign(new RSASSASigner(key));
            return jwt.serialize();
        }
        catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    /** Swaps in a new payload and keeps the original header and signature. */
    static String withPayload(String token, JWTClaimsSet claims) {
        String[] parts = token.split("\\.");
        String payload = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(claims.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return parts[0] + "." + payload + "." + parts[2];
    }

    /** The token's claims, read without checking anything. */
    static JWTClaimsSet unverifiedClaims(String token) {
        try {
            return SignedJWT.parse(token).getJWTClaimsSet();
        }
        catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    /** Flips one character in the middle of the signature. */
    static String withBrokenSignature(String token) {
        int dot = token.lastIndexOf('.');
        int at = dot + (token.length() - dot) / 2;
        char flipped = token.charAt(at) == 'A' ? 'B' : 'A';
        return token.substring(0, at) + flipped + token.substring(at + 1);
    }

    /** An unsigned token ("alg":"none") with the given claims. */
    static String unsigned(JWTClaimsSet claims) {
        Base64.Encoder b64 = Base64.getUrlEncoder().withoutPadding();
        String header = b64.encodeToString("{\"alg\":\"none\",\"typ\":\"JWT\"}".getBytes());
        String payload = b64.encodeToString(claims.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return header + "." + payload + ".";
    }
}
