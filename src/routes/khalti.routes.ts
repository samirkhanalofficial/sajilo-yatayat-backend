import express, { Response } from "express";
import { AuthUserRequest } from "../utils/types/auth-user-request";

import { khaltiRepository } from "../repository/khalti.repository";
import {
  KhaltiValidation,
  VerifyKhaltiPayment,
} from "../validation/khalti-validation";
import { fareRepository } from "../repository/fare.repository";

const khaltiRouter = express.Router();
// init payment
khaltiRouter.post(
  "/initpayment",
  async (req: AuthUserRequest, res: Response) => {
    try {
      const { error, value } = KhaltiValidation.validate(req.body);
      if (error) throw error.message;
      const fare = await fareRepository.getFareById(value.fare);
      if (!fare) throw "No Fare found";
      const data = await fetch("https://khalti.com/api/v2/payment/initiate/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          public_key: process.env.KHALTI_PUBLIC_KEY!,
          mobile: value.mobile,
          transaction_pin: value.transaction_pin,
          amount: fare.amount * 100,
          product_identity: value.fare,
          product_name: `ticket: ${value.fare}`,
          product_url:
            "https://sajilo-yatayat.samirk.com.np/fare?id=" + value.fare,
        }),
      })
        .then(async (res) => {
          const body = await res.json();
          console.log(body);
          if (res.status != 200) {
            throw "Incorrect mobile number or Pin";
          }
          return body;
        })
        .then(async (body) => {
          return body;
        });
      const khaltiData = await khaltiRepository.addData({
        isPaid: false,
        fare: value.fare,
        mobile: value.mobile,
        amount: fare.amount,
        token: data?.token ?? "",
      });
      if (!khaltiData) throw "error saving khaltiData";
      return res.status(200).json(data);
    } catch (e: any) {
      return res.status(400).json({ message: e.toString() });
    }
  }
);
// get khalti data by token

khaltiRouter.post("/verify", async (req: AuthUserRequest, res: Response) => {
  try {
    const { error, value } = VerifyKhaltiPayment.validate(req.body);
    if (error) throw error.message;
    const khaltiData = await khaltiRepository.getDataByToken(value.token);

    if (!khaltiData) throw "error making payment";

    const data = await fetch("https://khalti.com/api/v2/payment/confirm/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        public_key: process.env.KHALTI_PUBLIC_KEY!,
        transaction_pin: value.transaction_pin,
        token: value.token,
        confirmation_code: value.confirmation_code,
      }),
    })
      .then(async (res) => {
        const body = await res.json();
        console.log(body);
        if (res.status != 200) {
          throw "Error verifying confirmation code.";
        }
        return body;
      })
      .then(async (body) => {
        return body;
      });

    const updateKhalti = await khaltiRepository.updateKhaltiData(
      khaltiData._id
    );
    const setpaid = await fareRepository.payFareById(khaltiData.fare);
    if (!setpaid) throw "error updating to Paid status";
    if (!updateKhalti) throw "error updating khaltiData";
    return res.status(200).json(data);
  } catch (e: any) {
    return res.status(400).json({ message: e.toString() });
  }
});
export { khaltiRouter };
