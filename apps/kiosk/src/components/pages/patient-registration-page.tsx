"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Checkbox } from "@healthcare/ui/primitives";
import { birthDateProblem } from "@/lib/birth-date";
import { CIVIL_STATUSES, EMPTY_REGISTRATION, RELATIONSHIPS, type RegistrationForm, registrationForm, SEXES } from "@/lib/registration";
import { BigButton, BigInput, BigSelect, DateField, Field } from "../bits";
import { Frame } from "../frame";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-5 rounded-2xl border bg-card p-6">
      <h2 className="text-2xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/**
 * PatientRegistrationPage: the details reception needs to create a record. The same field names and rules as the front
 * desk's registration; the API checks them again. What is typed stays in this form's memory only — never in storage —
 * and goes to the API only when the person confirms on the next screen.
 */
export function PatientRegistrationPage({
  facilityName,
  today,
  privacyNotice,
  initial,
  onContinue,
  onBack,
  onStartOver,
}: {
  facilityName: string;
  today: string;
  privacyNotice: string;
  initial: Partial<RegistrationForm> | null;
  onContinue: (form: RegistrationForm) => void;
  onBack: () => void;
  onStartOver: () => void;
}) {
  const {
    register,
    control,
    handleSubmit,
    setError,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<RegistrationForm>({
    resolver: zodResolver(registrationForm),
    defaultValues: { ...EMPTY_REGISTRATION, ...initial } as RegistrationForm,
    mode: "onTouched",
  });

  const [day, month, year] = useWatch({ control, name: ["birthDay", "birthMonth", "birthYear"] });
  const birth = { day: day ?? "", month: month ?? "", year: year ?? "" };

  // The date of birth spans three inputs, so its problem is reported here, beside whatever else the schema found.
  const checkBirthDate = () => {
    const problem = birthDateProblem({ day: getValues("birthDay"), month: getValues("birthMonth"), year: getValues("birthYear") }, today);
    if (problem) setError("birthDay", { message: problem });
    return problem === null;
  };

  const submit = handleSubmit(
    (values) => {
      if (checkBirthDate()) onContinue(values);
    },
    () => void checkBirthDate(),
  );

  const message = (name: keyof RegistrationForm) => errors[name]?.message as string | undefined;

  return (
    <Frame title="Tell us about yourself" facilityName={facilityName} onBack={onBack} onStartOver={onStartOver}>
      <form onSubmit={submit} className="flex flex-col gap-6" noValidate autoComplete="off">
        <Section title="About you">
          <Field id="familyName" label="Family name (surname)" error={message("familyName")}>
            <BigInput id="familyName" aria-invalid={Boolean(errors.familyName)} {...register("familyName")} />
          </Field>
          <Field id="givenName" label="First name" error={message("givenName")}>
            <BigInput id="givenName" aria-invalid={Boolean(errors.givenName)} {...register("givenName")} />
          </Field>
          <Field id="middleName" label="Middle name (if any)" error={message("middleName")}>
            <BigInput id="middleName" {...register("middleName")} />
          </Field>
          <DateField
            idPrefix="birth"
            label="Date of birth"
            value={birth}
            onChange={(v) => {
              setValue("birthDay", v.day, { shouldDirty: true });
              setValue("birthMonth", v.month, { shouldDirty: true });
              setValue("birthYear", v.year, { shouldDirty: true });
            }}
            error={message("birthDay")}
          />
          <Field id="sex" label="Sex" error={message("sex")}>
            <BigSelect id="sex" placeholder="Choose…" aria-invalid={Boolean(errors.sex)} {...register("sex")}>
              {SEXES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </BigSelect>
          </Field>
          <Field id="civilStatus" label="Civil status (optional)">
            <BigSelect id="civilStatus" placeholder="Choose…" {...register("civilStatus")}>
              {CIVIL_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </BigSelect>
          </Field>
        </Section>

        <Section title="How we can reach you">
          <Field id="mobile" label="Mobile number" hint="For example 0917 123 4567" error={message("mobile")}>
            <BigInput id="mobile" inputMode="tel" aria-invalid={Boolean(errors.mobile)} {...register("mobile")} />
          </Field>
          <Field id="email" label="Email (optional)" error={message("email")}>
            <BigInput id="email" type="email" inputMode="email" aria-invalid={Boolean(errors.email)} {...register("email")} />
          </Field>
        </Section>

        <Section title="Where you live">
          <Field id="line1" label="House number and street (optional)" error={message("line1")}>
            <BigInput id="line1" {...register("line1")} />
          </Field>
          <Field id="barangay" label="Barangay (optional)" error={message("barangay")}>
            <BigInput id="barangay" {...register("barangay")} />
          </Field>
          <Field id="cityMunicipality" label="City or municipality" error={message("cityMunicipality")}>
            <BigInput id="cityMunicipality" aria-invalid={Boolean(errors.cityMunicipality)} {...register("cityMunicipality")} />
          </Field>
          <Field id="province" label="Province (optional)" error={message("province")}>
            <BigInput id="province" {...register("province")} />
          </Field>
          <Field id="postalCode" label="Postal code (optional)" error={message("postalCode")}>
            <BigInput id="postalCode" inputMode="numeric" maxLength={4} {...register("postalCode")} />
          </Field>
        </Section>

        <Section title="PhilHealth">
          <Field
            id="philhealthPin"
            label="PhilHealth number (optional)"
            hint="Reception will check it. You can also bring your PhilHealth card to the desk."
            error={message("philhealthPin")}
          >
            <BigInput id="philhealthPin" inputMode="numeric" {...register("philhealthPin")} />
          </Field>
        </Section>

        <Section title="Someone we can call in an emergency">
          <Field id="emergencyName" label="Their name" error={message("emergencyName")}>
            <BigInput id="emergencyName" aria-invalid={Boolean(errors.emergencyName)} {...register("emergencyName")} />
          </Field>
          <Field id="emergencyNumber" label="Their phone number" error={message("emergencyNumber")}>
            <BigInput id="emergencyNumber" inputMode="tel" aria-invalid={Boolean(errors.emergencyNumber)} {...register("emergencyNumber")} />
          </Field>
          <Field id="emergencyRelationship" label="Who are they to you?" error={message("emergencyRelationship")}>
            <BigSelect
              id="emergencyRelationship"
              placeholder="Choose…"

              aria-invalid={Boolean(errors.emergencyRelationship)}
              {...register("emergencyRelationship")}
            >
              {RELATIONSHIPS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </BigSelect>
          </Field>
        </Section>

        <Section title="Your privacy">
          <p className="text-xl leading-relaxed">{privacyNotice}</p>
          <Controller
            control={control}
            name="privacyAcknowledged"
            render={({ field }) => (
              <label className="flex cursor-pointer items-center gap-4 text-xl">
                <Checkbox
                  checked={field.value === true}
                  onCheckedChange={(checked) => field.onChange(checked === true ? true : undefined)}
                  className="size-10"
                  aria-invalid={Boolean(errors.privacyAcknowledged)}
                />
                I have read this and I agree to send my details to reception.
              </label>
            )}
          />
          {errors.privacyAcknowledged && (
            <p role="alert" className="text-lg font-medium text-danger">
              {errors.privacyAcknowledged.message as string}
            </p>
          )}
        </Section>

        <BigButton type="submit" className="self-start">
          Check my answers
        </BigButton>
      </form>
    </Frame>
  );
}
