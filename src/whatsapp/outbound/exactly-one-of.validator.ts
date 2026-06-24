import {
   registerDecorator,
   type ValidationArguments,
   type ValidationOptions
} from 'class-validator'

/**
 * Object-level constraint: exactly one of the named sibling properties must be
 * present (not null/undefined).
 *
 * class-validator has no native "exactly one of these fields" rule, and
 * @ValidateIf alone can't express it (it can't reject the "both present" case).
 * So we register a custom validator that inspects the whole object.
 *
 * Attach it to an ALWAYS-present property (e.g. `chatId`) so the check always
 * runs regardless of which sibling is set — attaching it to an optional field
 * would let @IsOptional skip it when that field is absent.
 */
export function ExactlyOneOf(properties: string[], options?: ValidationOptions) {
   return function (object: object, propertyName: string) {
      registerDecorator({
         name: 'exactlyOneOf',
         target: object.constructor,
         propertyName,
         constraints: [properties],
         options,
         validator: {
            validate(_value: unknown, args: ValidationArguments) {
               const [props] = args.constraints as [string[]]
               const present = props.filter(
                  (p) => (args.object as Record<string, unknown>)[p] != null
               )
               return present.length === 1
            },
            defaultMessage(args: ValidationArguments) {
               const [props] = args.constraints as [string[]]
               const present = props.filter(
                  (p) => (args.object as Record<string, unknown>)[p] != null
               )
               const quoted = props.map((p) => `\`${p}\``).join(' or ')

               if (present.length === 0) {
                  return `Message must include ${quoted}`
               }
               if (present.length > 1) {
                  return `Message cannot include both ${props.map((p) => `\`${p}\``).join(' and ')}`
               }
               return `Exactly one of ${props.join(', ')} must be provided`
            }
         }
      })
   }
}
