// The FFSA Vehicle Usage Policy & Agreement, mirrored from the BASE VEHICLES
// "FFSA Vehicle Policy & Agreement" doc. Version-tagged so each e-signature
// records exactly which terms were accepted. Bump VEHICLE_POLICY_VERSION
// whenever the terms below change.

export const VEHICLE_POLICY_VERSION = "2026-06";
export const VEHICLE_POLICY_TITLE = "FFSA Vehicle Usage Policy & Agreement";

export const VEHICLE_POLICY_INTRO =
  "By signing below you confirm that you have read, understood, and agree to abide by the FFSA Vehicle Usage Policy while using FFSA vehicles. Questions: the FFSA Vehicle Coordinator (vehicles@ffsouthafrica.com).";

export const VEHICLE_POLICY_SECTIONS: { heading: string; points: string[] }[] = [
  {
    heading: "1. Booking",
    points: [
      "All bookings must be made at least 48 hours in advance so the vehicle can be inspected.",
      "You must complete the Booking Form, Driver Form, this Vehicle Usage Policy, and the Indemnity form.",
      "Bookings are subject to approval: the FFSA Vehicle Coordinator (or an FFSA staff member) inspects the vehicle and checks that all forms and requirements are complete before the booking is approved.",
    ],
  },
  {
    heading: "2. Payment",
    points: [
      "Payment for the rental must be made to the FFSA finance team before the keys can be collected.",
      "Payment is by EFT (proof of payment to finance@ffsouthafrica.com) or by card with the finance team.",
    ],
  },
  {
    heading: "3. Collection",
    points: [
      "Keys are collected during working hours (Mon–Fri, 08h00–17h00) on the start date; weekend collections must be arranged in advance.",
      "The vehicle is provided fuelled, washed, and in full working order per the National Road Traffic Act.",
      "All drivers complete the vehicle inspection (Sign Out) and indemnity on collection — handle these diligently; they are legal forms.",
    ],
  },
  {
    heading: "4. Authorised drivers & usage",
    points: [
      "Only individuals with a valid driver's licence in English, approved by the FFSA Vehicle Coordinator and/or Leadership Team, may drive FFSA vehicles.",
      "First-time base-vehicle drivers and international drivers must pass a driving test beforehand.",
      "Lending or allowing unauthorised individuals to drive an FFSA vehicle is prohibited. If a student drives, the Outreach Leader remains responsible and a penalty may apply for any breach.",
    ],
  },
  {
    heading: "5. Reporting damage & faults",
    points: [
      "Immediately report any damage or accident to the corresponding FFSA staff member AND the FFSA Vehicle Coordinator.",
      "Immediately report any change in vehicle condition — driving, noise, or any mechanical/electrical fault.",
    ],
  },
  {
    heading: "6. Returning the vehicle",
    points: [
      "Give at least 24 hours' notice of the return; complete the vehicle condition (Sign In) and indemnity forms.",
      "Return the vehicle washed inside and out (bring the carwash receipt) and filled with the correct fuel — vans diesel, cars petrol — parked on base, with keys returned to the Legal Offices at FFSA Bult during working hours.",
      "A return inspection (damage, fuel, cleanliness, mileage) is done within 48 hours. If the vehicle is returned dirty, not refuelled, or with unreported damage, you are liable for all costs incurred.",
    ],
  },
  {
    heading: "7. Damage policy",
    points: [
      "Damage to the vehicle is the financial responsibility of the renter.",
      "Loss of or damage to the vehicle's AirTag or holder is charged to the renter.",
      "Repairs may be claimed from insurance at the discretion of FFSA Legal & Finance, with R20,000 excess payable by the renter per vehicle, per incident; the renter is liable for any insurer excess fees.",
    ],
  },
  {
    heading: "8. Traffic violations",
    points: [
      "All traffic fines and violations are the full responsibility of the renter, regardless of the time elapsed since the violation, plus a 10% admin fee at the discretion of FFSA Legal & Finance.",
    ],
  },
];
