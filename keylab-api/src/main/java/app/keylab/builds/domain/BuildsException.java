package app.keylab.builds.domain;

/**
 * A rule of builds said no. Each subtype is one stable reason; the web
 * adapter maps it to its RFC 9457 problem (adapter/in/web/BuildProblems), so
 * nothing in the domain knows about HTTP.
 */
public abstract class BuildsException extends RuntimeException {

    protected BuildsException(String message) {
        super(message);
    }
}
