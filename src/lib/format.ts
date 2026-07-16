function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

// Teléfono dominicano: 000-000-0000, progresivo mientras se escribe.
export function formatPhone(value: string): string {
  const digits = onlyDigits(value).slice(0, 10);
  const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 10)];
  return parts.filter(Boolean).join('-');
}

// RNC (9 dígitos, 000-00000-0) o Cédula (11 dígitos, 000-0000000-0). Como
// ambos comparten el mismo campo, se agrupa como RNC hasta el 9no dígito y
// se re-agrupa como cédula al escribir el 10mo/11mo.
export function formatCedulaOrRnc(value: string): string {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 9) {
    const parts = [digits.slice(0, 3), digits.slice(3, 8), digits.slice(8, 9)];
    return parts.filter(Boolean).join('-');
  }
  const parts = [digits.slice(0, 3), digits.slice(3, 10), digits.slice(10, 11)];
  return parts.filter(Boolean).join('-');
}
