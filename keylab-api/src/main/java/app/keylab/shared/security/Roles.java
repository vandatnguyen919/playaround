package app.keylab.shared.security;

/**
 * The Keycloak realm roles KeyLab knows (api-design-v1.md, Summary), for
 * {@code @PreAuthorize("hasRole('" + Roles.EDITOR + "')")} and request rules.
 * Team roles are ordered viewer, editor, admin; each includes the one before.
 */
public final class Roles {

    /** Members: everything under /v1/me and writes on their own records. */
    public static final String USER = "keylab-user";

    /** Team, read only: the lowest role for anything under /v1/admin. */
    public static final String VIEWER = "keylab-viewer";

    public static final String EDITOR = "keylab-editor";

    public static final String ADMIN = "keylab-admin";

    private Roles() {
    }
}
