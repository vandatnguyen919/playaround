package app.keylab.shared;

/**
 * An amount in the currency's minor unit (cents), as in the API's Money
 * schema: {@code { "amountMinor": 900, "currency": "USD" }}.
 */
public record Money(long amountMinor, String currency) {

    public Money {
        if (currency == null || !currency.matches("[A-Z]{3}")) {
            throw new IllegalArgumentException("Currency must be a three letter ISO 4217 code");
        }
    }
}
