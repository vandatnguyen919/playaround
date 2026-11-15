package app.keylab.shared.security;

import java.io.IOException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.server.resource.web.BearerTokenAuthenticationEntryPoint;
import org.springframework.security.oauth2.server.resource.web.access.BearerTokenAccessDeniedHandler;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.web.servlet.HandlerExceptionResolver;

/**
 * 401 and 403 from the security filters, which run before any controller.
 * The stock bearer token handlers set the status and the WWW-Authenticate
 * challenge (invalid_token, insufficient_scope); the exception then goes to
 * ProblemAdvice, which writes the problem+json body like for any other error.
 */
final class ProblemSecurityHandlers implements AuthenticationEntryPoint, AccessDeniedHandler {

    private final BearerTokenAuthenticationEntryPoint challenge = new BearerTokenAuthenticationEntryPoint();
    private final BearerTokenAccessDeniedHandler denied = new BearerTokenAccessDeniedHandler();
    private final HandlerExceptionResolver exceptionResolver;

    ProblemSecurityHandlers(HandlerExceptionResolver exceptionResolver) {
        this.exceptionResolver = exceptionResolver;
    }

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response,
            AuthenticationException authException) throws IOException {
        challenge.commence(request, response, authException);
        exceptionResolver.resolveException(request, response, null, authException);
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response,
            AccessDeniedException accessDeniedException) throws IOException {
        denied.handle(request, response, accessDeniedException);
        exceptionResolver.resolveException(request, response, null, accessDeniedException);
    }
}
