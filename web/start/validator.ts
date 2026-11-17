/*
|--------------------------------------------------------------------------
| Validator file
|--------------------------------------------------------------------------
|
| The validator file is used for configuring global transforms for VineJS.
| The transform below converts all VineJS date outputs from JavaScript
| Date objects to Luxon DateTime instances, so that validated dates are
| ready to use with Lucid models and other parts of the app that expect
| Luxon DateTime.
|
*/

import { DateTime } from 'luxon'
import vine, { SimpleMessagesProvider, VineDate } from '@vinejs/vine'

vine.messagesProvider = new SimpleMessagesProvider(
  {
    'required': 'Pole „{{ field }}” jest wymagane.',
    'string': 'Pole „{{ field }}” musi być tekstem.',
    'email': 'Pole „{{ field }}” musi zawierać poprawny adres e-mail.',
    'mobile': 'Pole „{{ field }}” musi zawierać poprawny numer telefonu.',
    'creditCard': 'Pole „{{ field }}” musi zawierać poprawny numer karty {{ providersList }}.',
    'passport': 'Pole „{{ field }}” musi zawierać poprawny numer paszportu.',
    'postalCode': 'Pole „{{ field }}” musi zawierać poprawny kod pocztowy.',
    'regex': 'Format pola „{{ field }}” jest nieprawidłowy.',
    'ascii': 'Pole „{{ field }}” może zawierać tylko znaki ASCII.',
    'iban': 'Pole „{{ field }}” musi zawierać poprawny numer IBAN.',
    'jwt': 'Pole „{{ field }}” musi zawierać poprawny token JWT.',
    'coordinates': 'Pole „{{ field }}” musi zawierać szerokość i długość geograficzną.',
    'url': 'Pole „{{ field }}” musi zawierać poprawny adres URL.',
    'activeUrl': 'Pole „{{ field }}” musi zawierać aktywny adres URL.',
    'alpha': 'Pole „{{ field }}” może zawierać tylko litery.',
    'alphaNumeric': 'Pole „{{ field }}” może zawierać tylko litery i cyfry.',
    'minLength': 'Pole „{{ field }}” musi mieć co najmniej {{ min }} znaków.',
    'maxLength': 'Pole „{{ field }}” może mieć najwyżej {{ max }} znaków.',
    'fixedLength': 'Pole „{{ field }}” musi mieć dokładnie {{ size }} znaków.',
    'sameAs': 'Pola „{{ field }}” i „{{ otherField }}” muszą być takie same.',
    'notSameAs': 'Pola „{{ field }}” i „{{ otherField }}” muszą się różnić.',
    'confirmed': 'Pola „{{ originalField }}” i „{{ otherField }}” muszą być takie same.',
    'startsWith': 'Pole „{{ field }}” musi zaczynać się od „{{ substring }}”.',
    'endsWith': 'Pole „{{ field }}” musi kończyć się na „{{ substring }}”.',
    'ipAddress': 'Pole „{{ field }}” musi zawierać poprawny adres IP.',
    'uuid': 'Pole „{{ field }}” musi zawierać poprawny identyfikator UUID.',
    'ulid': 'Pole „{{ field }}” musi zawierać poprawny identyfikator ULID.',
    'boolean': 'Pole „{{ field }}” musi mieć wartość tak lub nie.',
    'number': 'Pole „{{ field }}” musi być liczbą.',
    'min': 'Pole „{{ field }}” musi mieć wartość co najmniej {{ min }}.',
    'max': 'Pole „{{ field }}” może mieć wartość najwyżej {{ max }}.',
    'range': 'Pole „{{ field }}” musi mieć wartość od {{ min }} do {{ max }}.',
    'positive': 'Pole „{{ field }}” musi być liczbą większą od zera.',
    'negative': 'Pole „{{ field }}” musi być liczbą mniejszą od zera.',
    'nonNegative': 'Pole „{{ field }}” nie może być liczbą ujemną.',
    'nonPositive': 'Pole „{{ field }}” nie może być liczbą dodatnią.',
    'decimal': 'Pole „{{ field }}” musi mieć {{ digits }} miejsc po przecinku.',
    'withoutDecimals': 'Pole „{{ field }}” musi być liczbą całkowitą.',
    'accepted': 'Pole „{{ field }}” musi zostać zaakceptowane.',
    'enum': 'Wybrana wartość pola „{{ field }}” jest nieprawidłowa.',
    'in': 'Wybrana wartość pola „{{ field }}” jest nieprawidłowa.',
    'notIn': 'Wybrana wartość pola „{{ field }}” jest nieprawidłowa.',
    'literal': 'Pole „{{ field }}” musi mieć wartość „{{ expectedValue }}”.',
    'database.unique': 'Ta wartość pola „{{ field }}” jest już używana.',
    'database.exists': 'Wybrana wartość pola „{{ field }}” nie istnieje.',
    'date': 'Pole „{{ field }}” musi zawierać poprawną datę i godzinę.',
    'array': 'Pole „{{ field }}” musi być listą.',
    'array.minLength': 'Pole „{{ field }}” musi zawierać co najmniej {{ min }} elementów.',
    'array.maxLength': 'Pole „{{ field }}” może zawierać najwyżej {{ max }} elementów.',
    'array.fixedLength': 'Pole „{{ field }}” musi zawierać dokładnie {{ size }} elementów.',
    'notEmpty': 'Pole „{{ field }}” nie może być puste.',
    'distinct': 'Pole „{{ field }}” zawiera powtarzające się wartości.',
    'object': 'Pole „{{ field }}” musi być obiektem.',
    'record': 'Pole „{{ field }}” musi być obiektem.',
    'tuple': 'Pole „{{ field }}” musi być listą.',
    'union': 'Wartość pola „{{ field }}” jest nieprawidłowa.',
    'unionGroup': 'Wartość pola „{{ field }}” jest nieprawidłowa.',
    'unionOfTypes': 'Wartość pola „{{ field }}” jest nieprawidłowa.',
    'nativeFile': 'Pole „{{ field }}” musi zawierać poprawny plik.',
  },
  {
    fullName: 'imię i nazwisko',
    email: 'adres e-mail',
    password: 'hasło',
    passwordConfirmation: 'powtórzenie hasła',
    code: 'kod aktywacyjny',
    token: 'token resetu hasła',
    origin: 'stacja początkowa',
    originStationId: 'identyfikator stacji początkowej',
    destination: 'stacja docelowa',
    destinationStationId: 'identyfikator stacji docelowej',
    travelDate: 'data podróży',
    departureTime: 'godzina odjazdu',
    arrivalTime: 'godzina przyjazdu',
    arrivalDate: 'data przyjazdu',
    connectionUuid: 'identyfikator połączenia',
    trainName: 'nazwa pociągu',
    priceCents: 'cena',
    targetPrice: 'próg ceny',
    checkIntervalMinutes: 'częstotliwość sprawdzania',
    onlyDirect: 'tylko połączenia bezpośrednie',
    status: 'status obserwacji',
  }
)

declare module '@vinejs/vine/types' {
  interface VineGlobalTransforms {
    date: DateTime
  }
}

VineDate.transform((value) => DateTime.fromJSDate(value))
