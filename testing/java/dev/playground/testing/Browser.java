package dev.playground.testing;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * One browser's worth of cookies over plain HTTP, with redirects followed by
 * hand. Cookies on localhost are shared across ports, as in a real browser,
 * so one jar covers the gateway and Keycloak (their cookie names differ).
 */
public final class Browser {

    private static final Pattern KC_LOGIN_ACTION = Pattern.compile("\"loginAction\":\\s*\"([^\"]+)\"");
    private static final Pattern FORM_ACTION = Pattern.compile("<form[^>]*\\baction=\"([^\"]+)\"");

    private final HttpClient http = HttpClient.newBuilder()
        .followRedirects(HttpClient.Redirect.NEVER)
        .connectTimeout(Duration.ofSeconds(5))
        .build();

    public final Map<String, String> cookies = new LinkedHashMap<>();

    /** The last page fetched, with the URL it came from. */
    public record Page(int status, String url, String body, HttpResponse<String> response) {
    }

    public HttpResponse<String> send(String method, String url, String formBody, Map<String, String> headers)
            throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(20));
        if (!this.cookies.isEmpty()) {
            request.header("Cookie", this.cookies.entrySet().stream()
                .map((e) -> e.getKey() + "=" + e.getValue()).collect(Collectors.joining("; ")));
        }
        headers.forEach(request::header);
        if (formBody != null) {
            request.header("Content-Type", "application/x-www-form-urlencoded");
            request.method(method, HttpRequest.BodyPublishers.ofString(formBody));
        }
        else {
            request.method(method, HttpRequest.BodyPublishers.noBody());
        }
        HttpResponse<String> response = this.http.send(request.build(), HttpResponse.BodyHandlers.ofString());
        store(response);
        return response;
    }

    /** An XHR-like call: no redirects followed, CSRF header added when the cookie is there. */
    public HttpResponse<String> xhr(String method, String url) throws Exception {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Accept", "application/json");
        if (this.cookies.containsKey("XSRF-TOKEN")) {
            headers.put("X-XSRF-TOKEN", this.cookies.get("XSRF-TOKEN"));
        }
        return send(method, url, null, headers);
    }

    /** A top-level navigation: follows redirects, the last hop is a GET. */
    public Page navigate(String method, String url, String formBody) throws Exception {
        String current = url;
        String currentMethod = method;
        String body = formBody;
        for (int hop = 0; hop < 15; hop++) {
            HttpResponse<String> response = send(currentMethod, current, body, Map.of("Accept", "text/html"));
            String location = response.headers().firstValue("Location").orElse(null);
            if (response.statusCode() >= 300 && response.statusCode() < 400 && location != null) {
                current = URI.create(current).resolve(location).toString();
                currentMethod = "GET";
                body = null;
                continue;
            }
            return new Page(response.statusCode(), current, response.body(), response);
        }
        throw new IllegalStateException("Too many redirects from " + url);
    }

    /**
     * Starts the gateway's login at {appUrl}/oauth2/authorization/gateway and
     * submits the Keycloak login form. Returns the page it ends on.
     */
    public Page signIn(String appUrl, String username, String password) throws Exception {
        Page loginPage = navigate("GET", appUrl + "/oauth2/authorization/gateway", null);
        String action = loginAction(loginPage);
        return navigate("POST", action, KeycloakRealm.formBody(Map.of(
                "username", username, "password", password, "credentialId", "")));
    }

    /** The login form's action URL, from the stock theme's form or a Keycloakify kcContext. */
    public static String loginAction(Page page) {
        Matcher kc = KC_LOGIN_ACTION.matcher(page.body());
        Matcher form = FORM_ACTION.matcher(page.body());
        String raw;
        if (kc.find()) {
            raw = kc.group(1).replace("\\/", "/").replace("\\u0026", "&");
        }
        else if (form.find()) {
            raw = form.group(1);
        }
        else {
            throw new IllegalStateException("No login form at " + page.url() + " (HTTP " + page.status() + ")");
        }
        return URI.create(page.url()).resolve(raw.replace("&amp;", "&")).toString();
    }

    private void store(HttpResponse<String> response) {
        for (String line : response.headers().allValues("Set-Cookie")) {
            String[] parts = line.split(";");
            int eq = parts[0].indexOf('=');
            String name = parts[0].substring(0, eq).trim();
            String value = parts[0].substring(eq + 1).trim();
            boolean expired = value.isEmpty();
            for (int i = 1; i < parts.length; i++) {
                String attr = parts[i].trim().toLowerCase();
                if (attr.equals("max-age=0") || attr.startsWith("expires=thu, 01 jan 1970")) {
                    expired = true;
                }
            }
            if (expired) {
                this.cookies.remove(name);
            }
            else {
                this.cookies.put(name, value);
            }
        }
    }
}
