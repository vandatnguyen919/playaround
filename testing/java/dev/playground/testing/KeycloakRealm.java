package dev.playground.testing;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;

import com.jayway.jsonpath.JsonPath;

import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.Network;
import org.testcontainers.containers.startupcheck.OneShotStartupCheckStrategy;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.MountableFile;

/**
 * Keycloak 26.8.1 in Testcontainers with the playground realm applied the same
 * way dev does it: keycloak-config-cli runs infra/playground-realm.json and
 * infra/playground-users-dev.json through the admin API, then exits. The
 * images and environment mirror infra/docker-compose.yml.
 *
 * The theme jar is not mounted, so Keycloak serves its stock login pages
 * (it logs that the realm's theme is missing and falls back). These tests
 * are about sessions and tokens, not the theme; Playwright covers the theme.
 *
 * Dev test users from playground-users-dev.json: alice@example.com /
 * alice1234 (user) and admin@example.com / admin1234 (user, admin).
 */
public final class KeycloakRealm implements AutoCloseable {

    public static final String REALM = "playground";
    public static final String KEYCLOAK_IMAGE = "quay.io/keycloak/keycloak:26.8.1";
    public static final String CONFIG_CLI_IMAGE = "adorsys/keycloak-config-cli:6.5.1-26.5.5";
    public static final String GATEWAY_CLIENT_SECRET = "test-gateway-secret";

    public static final String USER_EMAIL = "alice@example.com";
    public static final String USER_PASSWORD = "alice1234";
    public static final String ADMIN_EMAIL = "admin@example.com";
    public static final String ADMIN_PASSWORD = "admin1234";

    private static final Path ROOT = Path.of("..").toAbsolutePath().normalize();

    private final Network network = Network.newNetwork();
    /** The test host as Keycloak's container sees it; unknown to the host itself. */
    public static final String HOST_ALIAS = "gateway-host.test";

    private final GenericContainer<?> keycloak;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    private KeycloakRealm() {
        this.keycloak = new GenericContainer<>(KEYCLOAK_IMAGE)
            .withNetwork(this.network)
            .withNetworkAliases("keycloak")
            // Back-channel logout reaches a gateway running on the host by this
            // name, as in infra/docker-compose.yml. host-gateway makes it work
            // on Linux (CI) as well as Docker Desktop.
            .withExtraHost("host.docker.internal", "host-gateway")
            // The same host under a name only the container knows, so a test can
            // check the gateway never needs to resolve the name Keycloak called.
            .withExtraHost(HOST_ALIAS, "host-gateway")
            .withCommand("start-dev")
            .withEnv("KC_BOOTSTRAP_ADMIN_USERNAME", "admin")
            .withEnv("KC_BOOTSTRAP_ADMIN_PASSWORD", "admin")
            .withEnv("KC_HEALTH_ENABLED", "true")
            .withExposedPorts(8080, 9000)
            .waitingFor(Wait.forHttp("/health/ready").forPort(9000)
                .withStartupTimeout(Duration.ofMinutes(4)));
    }

    /**
     * Starts Keycloak and applies the realm.
     *
     * @param appUrl the application origin, as in compose (redirect URIs are
     *        {appUrl}/*, post-logout redirect reuses them)
     * @param backChannelLogoutUrl where Keycloak posts logout tokens
     */
    public static KeycloakRealm start(String appUrl, String backChannelLogoutUrl) {
        KeycloakRealm realm = new KeycloakRealm();
        realm.keycloak.start();
        realm.applyRealm(appUrl, backChannelLogoutUrl);
        return realm;
    }

    private void applyRealm(String appUrl, String backChannelLogoutUrl) {
        Map<String, String> env = new LinkedHashMap<>();
        env.put("KEYCLOAK_URL", "http://keycloak:8080");
        env.put("KEYCLOAK_USER", "admin");
        env.put("KEYCLOAK_PASSWORD", "admin");
        env.put("KEYCLOAK_AVAILABILITYCHECK_ENABLED", "true");
        env.put("IMPORT_FILES_LOCATIONS", "/config/playground-realm.json,/config/playground-users-dev.json");
        env.put("IMPORT_VARSUBSTITUTION_ENABLED", "true");
        env.put("IMPORT_CACHE_ENABLED", "false");
        env.put("APP_URL", appUrl);
        env.put("GATEWAY_BACKCHANNEL_LOGOUT_URL", backChannelLogoutUrl);
        env.put("GATEWAY_CLIENT_SECRET", GATEWAY_CLIENT_SECRET);
        env.put("JENKINS_CLIENT_SECRET", "test-jenkins-secret");
        env.put("GOOGLE_CLIENT_ID", "google-client-id-not-configured");
        env.put("GOOGLE_CLIENT_SECRET", "google-client-secret-not-configured");
        env.put("GITHUB_CLIENT_ID", "github-client-id-not-configured");
        env.put("GITHUB_CLIENT_SECRET", "github-client-secret-not-configured");
        env.put("SMTP_HOST", "mailpit");
        env.put("SMTP_PORT", "1025");
        env.put("SMTP_FROM", "keycloak@playground.local");
        env.put("SMTP_SSL", "false");
        env.put("SMTP_STARTTLS", "false");
        env.put("SMTP_AUTH", "false");
        env.put("SMTP_USER", "");
        env.put("SMTP_PASSWORD", "");

        Path realmFile = ROOT.resolve("infra/playground-realm.json");
        Path usersFile = ROOT.resolve("infra/playground-users-dev.json");
        if (!Files.exists(realmFile) || !Files.exists(usersFile)) {
            throw new IllegalStateException("Realm files not found under " + ROOT.resolve("infra"));
        }
        // OneShotStartupCheckStrategy: start() returns once the container has
        // exited 0 and throws on any other exit code, with its logs attached.
        try (GenericContainer<?> configCli = new GenericContainer<>(CONFIG_CLI_IMAGE)
                .withNetwork(this.network)
                .withEnv(env)
                .withCopyFileToContainer(MountableFile.forHostPath(realmFile), "/config/playground-realm.json")
                .withCopyFileToContainer(MountableFile.forHostPath(usersFile), "/config/playground-users-dev.json")
                .withStartupCheckStrategy(new OneShotStartupCheckStrategy().withTimeout(Duration.ofMinutes(3)))) {
            configCli.start();
        }
    }

    /** Keycloak's container log, for assertion messages. */
    public String logs() {
        return this.keycloak.getLogs();
    }

    /**
     * Whether Keycloak's container can open a TCP connection to host:port, for
     * assertion messages about back-channel calls (bash /dev/tcp; the image has no curl).
     */
    public String canReach(String host, int port) {
        try {
            var result = this.keycloak.execInContainer("bash", "-c",
                "getent hosts " + host + "; timeout 5 bash -c '</dev/tcp/" + host + "/" + port
                    + "' && echo open || echo 'not reachable'");
            return result.getStdout().trim() + result.getStderr().trim();
        } catch (Exception e) {
            return "probe failed: " + e;
        }
    }

    /** Keycloak as the host sees it, for example http://localhost:49153. */
    public String baseUrl() {
        return "http://" + this.keycloak.getHost() + ":" + this.keycloak.getMappedPort(8080);
    }

    public String issuerUri() {
        return baseUrl() + "/realms/" + REALM;
    }

    public String jwkSetUri() {
        return issuerUri() + "/protocol/openid-connect/certs";
    }

    /** A public client with the password grant, for tests that need a real token without a browser. */
    public void createPasswordGrantClient(String clientId) throws Exception {
        HttpResponse<String> res = admin("POST", "/clients", """
                {"clientId":"%s","publicClient":true,"directAccessGrantsEnabled":true,
                 "standardFlowEnabled":false,"protocol":"openid-connect"}
                """.formatted(clientId));
        if (res.statusCode() != 201) {
            throw new IllegalStateException("Create client failed: HTTP " + res.statusCode() + " " + res.body());
        }
    }

    /** An access token for the user from a password grant client (see createPasswordGrantClient). */
    public String passwordGrantToken(String clientId, String username, String password) throws Exception {
        HttpResponse<String> res = post(issuerUri() + "/protocol/openid-connect/token", Map.of(
                "grant_type", "password", "client_id", clientId, "username", username,
                "password", password, "scope", "openid"));
        if (res.statusCode() != 200) {
            throw new IllegalStateException("Token request failed: HTTP " + res.statusCode() + " " + res.body());
        }
        return JsonPath.read(res.body(), "$.access_token");
    }

    /** Ends every Keycloak session of the user, as an admin would. Triggers back-channel logout. */
    public void logoutUser(String email) throws Exception {
        HttpResponse<String> list = admin("GET", "/users?exact=true&email=" + encode(email), null);
        java.util.List<String> ids = JsonPath.read(list.body(), "$[*].id");
        if (ids.isEmpty()) {
            throw new IllegalStateException("No user " + email);
        }
        HttpResponse<String> res = admin("POST", "/users/" + ids.get(0) + "/logout", null);
        if (res.statusCode() != 204) {
            throw new IllegalStateException("Logout failed: HTTP " + res.statusCode() + " " + res.body());
        }
    }

    public HttpResponse<String> admin(String method, String path, String json) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(baseUrl() + "/admin/realms/" + REALM + path))
            .header("Authorization", "Bearer " + adminToken())
            .timeout(Duration.ofSeconds(20));
        if (json != null) {
            request.header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofString(json));
        }
        else {
            request.method(method, HttpRequest.BodyPublishers.noBody());
        }
        return this.http.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private String adminToken() throws Exception {
        HttpResponse<String> res = post(baseUrl() + "/realms/master/protocol/openid-connect/token", Map.of(
                "grant_type", "password", "client_id", "admin-cli", "username", "admin", "password", "admin"));
        if (res.statusCode() != 200) {
            throw new IllegalStateException("Admin token failed: HTTP " + res.statusCode());
        }
        return JsonPath.read(res.body(), "$.access_token");
    }

    private HttpResponse<String> post(String url, Map<String, String> form) throws Exception {
        return this.http.send(HttpRequest.newBuilder(URI.create(url))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .timeout(Duration.ofSeconds(20))
            .POST(HttpRequest.BodyPublishers.ofString(formBody(form)))
            .build(), HttpResponse.BodyHandlers.ofString());
    }

    public static String formBody(Map<String, String> form) {
        return form.entrySet().stream()
            .map((e) -> encode(e.getKey()) + "=" + encode(e.getValue()))
            .collect(Collectors.joining("&"));
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    @Override
    public void close() {
        this.keycloak.stop();
        this.network.close();
    }
}
