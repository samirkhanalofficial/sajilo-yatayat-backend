import express, { Response } from "express";
import { AuthUserRequest } from "../utils/types/auth-user-request";
import { createFareValidation } from "../validation/create-fare.validation";
import { fareRepository } from "../repository/fare.repository";
import { FARESTATUS } from "../utils/enums/departure-status.enum";
import { departureRepository } from "../repository/departure.repository";
import Joi from "joi";
import { busRepository } from "../repository/bus.repository";
import admin from "firebase-admin";
const fareRouter = express.Router();
fareRouter.post("/create", async (req: AuthUserRequest, res: Response) => {
  try {
    const { error, value } = await createFareValidation.validate(req.body);
    if (error) throw error.message;
    const departureExists = await departureRepository.getDepartureById(
      value.departure
    );
    if (!departureExists) throw "Invalid departure Id";
    const bookedSeats = await fareRepository.getBookedSeatByDepartureId(
      value.departure
    );
    for (let toBookSeat of value.seats) {
      if (
        parseInt(toBookSeat.toString()) >
          departureExists.bus.leftSeats +
            departureExists.bus.rightSeats +
            departureExists.bus.lastSeats ||
        parseInt(toBookSeat.toString()) <= 0
      ) {
        throw `Seat no. ${toBookSeat} doesn't exists.`;
      }
      if (
        bookedSeats.filter(
          (alreadyBookedSeat) =>
            alreadyBookedSeat === parseInt(toBookSeat.toString())
        ).length != 0
      ) {
        throw `${toBookSeat} has already been booked.`;
      }
    }

    let fare = await fareRepository.createFare({
      ...value,
      faredBy: req.user?.id ?? "",
      bus: departureExists.bus.id,
      isFaredByUser: true,
      status: FARESTATUS.PENDING,
    });
    if (value.amount >= value.seats.length * departureExists.amount) {
      fare = await fareRepository.approveFareById(fare.id);
    }
    const messenging = admin.messaging();

    await messenging.send({
      topic: fare.bus.id,
      notification: {
        title: `New Fare Request @ Rs ${fare.amount}`,
        body: `${fare.bus.busnumber}  : (${fare.departure.from.name} - ${fare.departure.to.name}, please check it out as soon as possible.`,
      },
    });

    return res.status(201).json(fare);
  } catch (error) {
    console.log(error);
    return res.status(400).json({ message: error });
  }
});

fareRouter.get("/user-fares", async (req: AuthUserRequest, res: Response) => {
  try {
    const fares = await fareRepository.getUsersFares(req.user!.id);
    return res.status(200).json(fares);
  } catch (error) {
    return res.status(400).json({ message: error });
  }
});

fareRouter.get(
  "/bus-fares/:id",
  async (req: AuthUserRequest, res: Response) => {
    try {
      const { error, value } = await Joi.object({
        busId: Joi.string().required(),
      }).validate({
        busId: req.params.id,
      });
      if (error) throw error.message;
      const fares = await fareRepository.getBusFares(value.busId);
      return res.status(200).json(fares);
    } catch (error) {
      return res.status(400).json({ message: error });
    }
  }
);
fareRouter.patch("/accept/:id", async (req: AuthUserRequest, res: Response) => {
  try {
    const { error, value } = await Joi.object({
      fareId: Joi.string().required(),
    }).validate({
      fareId: req.params.id,
    });
    if (error) throw error.message;
    const fare = await fareRepository.getFareById(value.fareId);
    if (!fare) throw "No fare found";
    const isBusOwner = await busRepository.isOwnerOfBus(
      fare.bus.id,
      req.user!.id
    );
    if (fare.status !== FARESTATUS.PENDING)
      throw `fares that are ${fare.status} cannot be approved.`;

    // restrict other than bus owner & farerer
    if (fare.faredBy.id != req.user!.id && !isBusOwner)
      throw "You dont have permission to accept this fare.";
    if (
      (fare.isFaredByUser && !isBusOwner) ||
      (!fare.isFaredByUser && isBusOwner)
    )
      throw "You cant accept your own fare.";

    const fares = await fareRepository.approveFareById(value.fareId);
    const messenging = admin.messaging();

    await messenging.send({
      topic: !isBusOwner ? fare.bus.id : fare.faredBy.id,
      notification: {
        title: `Fare Accepted @ Rs ${fare.amount}`,
        body: `${fare.bus.busnumber}  : (${fare.departure.from.name} - ${
          fare.departure.to.name
        }, ${
          !isBusOwner
            ? "please check it out as soon as possible."
            : "please pay faster to avoid getting cancelled."
        }`,
      },
    });
    return res.status(200).json(fares);
  } catch (error) {
    return res.status(400).json({ message: error });
  }
});

fareRouter.patch(
  "/changePrice/:id",
  async (req: AuthUserRequest, res: Response) => {
    try {
      const { error, value } = await Joi.object({
        fareId: Joi.string().required(),
        amount: Joi.number().required(),
      }).validate({
        fareId: req.params.id,
        ...req.body,
      });

      if (error) throw error.message;
      const fare = await fareRepository.getFareById(value.fareId);
      if (!fare) throw "No fare found";
      const isBusOwner = await busRepository.isOwnerOfBus(
        fare.bus.id,
        req.user!.id
      );
      if (fare.status !== FARESTATUS.PENDING)
        throw `fares that are ${fare.status} cannot be approved.`;

      // restrict other than bus owner & farerer
      if (fare.faredBy.id != req.user!.id && !isBusOwner)
        throw "You dont have permission to change this fare.";
      if (
        (fare.isFaredByUser && !isBusOwner) ||
        (!fare.isFaredByUser && isBusOwner)
      )
        throw "you cant change your own fare";
      const fares = await fareRepository.updateFarePriceById(
        value.fareId,
        value.amount,
        !isBusOwner
      );
      const messenging = admin.messaging();

      await messenging.send({
        topic: !isBusOwner ? fare.bus.id : fare.faredBy.id,
        notification: {
          title: `Fare Modified @ Rs ${fare.amount}`,
          body: `${fare.bus.busnumber}  : (${fare.departure.from.name} - ${fare.departure.to.name}, please check it out as soon as possible.`,
        },
      });
      return res.status(200).json(fares);
    } catch (error) {
      return res.status(400).json({ message: error });
    }
  }
);

fareRouter.patch("/reject/:id", async (req: AuthUserRequest, res: Response) => {
  try {
    const { error, value } = await Joi.object({
      fareId: Joi.string().required(),
    }).validate({
      fareId: req.params.id,
    });
    if (error) throw error.message;
    const fare = await fareRepository.getFareById(value.fareId);
    if (!fare) throw "No fare found";
    const isBusOwner = await busRepository.isOwnerOfBus(
      fare.bus.id,
      req.user!.id
    );
    if (fare.status !== FARESTATUS.PENDING)
      throw `fares that are ${fare.status} cannot be rejected.`;
    // restrict other than bus owner & farerer
    if (fare.faredBy.id != req.user!.id && !isBusOwner)
      throw "You dont have permission to reject this fare.";
    if (
      (fare.isFaredByUser && !isBusOwner) ||
      (!fare.isFaredByUser && isBusOwner)
    )
      throw "You can't reject your own fare";
    const fares = await fareRepository.rejectFareById(value.fareId);
    const messenging = admin.messaging();

    await messenging.send({
      topic: !isBusOwner ? fare.bus.id : fare.faredBy.id,
      notification: {
        title: `Fare rejected @ Rs ${fare.amount}`,
        body: `${fare.bus.busnumber}  : (${fare.departure.from.name} - ${fare.departure.to.name}, we are really sorry for this."
        }`,
      },
    });
    return res.status(200).json(fares);
  } catch (error) {
    return res.status(400).json({ message: error });
  }
});
fareRouter.patch("/cancel/:id", async (req: AuthUserRequest, res: Response) => {
  try {
    const { error, value } = await Joi.object({
      fareId: Joi.string().required(),
    }).validate({
      fareId: req.params.id,
    });
    if (error) throw error.message;
    const fare = await fareRepository.getFareById(value.fareId);
    if (!fare) throw "No fare found";
    const isBusOwner = await busRepository.isOwnerOfBus(
      fare.bus.id,
      req.user!.id
    );
    if (
      fare.status !== FARESTATUS.PENDING &&
      fare.status !== FARESTATUS.ACCEPTED
    )
      throw `fares that are ${fare.status} cannot be cancelled.`;
    // restrict other than bus owner & farerer
    if (fare.faredBy.id != req.user!.id && !isBusOwner)
      throw "You dont have permission to cancel this fare.";

    const fares = await fareRepository.cancelFareById(value.fareId);
    const messenging = admin.messaging();

    await messenging.send({
      topic: !isBusOwner ? fare.bus.id : fare.faredBy.id,
      notification: {
        title: `Fare Cancelled @ Rs ${fare.amount}`,
        body: `${fare.bus.busnumber}  : (${fare.departure.from.name} - ${fare.departure.to.name}, we are sorry to inform you that the fare has been cancelled.`,
      },
    });
    return res.status(200).json(fares);
  } catch (error) {
    return res.status(400).json({ message: error });
  }
});
fareRouter.patch(
  "/complete/:id",
  async (req: AuthUserRequest, res: Response) => {
    try {
      const { error, value } = await Joi.object({
        fareId: Joi.string().required(),
      }).validate({
        fareId: req.params.id,
      });
      if (error) throw error.message;
      const fare = await fareRepository.getFareById(value.fareId);
      if (!fare) throw "No fare found";
      const isBusOwner = await busRepository.isOwnerOfBus(
        fare.bus.id,
        req.user!.id
      );
      if (fare.status !== FARESTATUS.PAID)
        throw `fares that are ${fare.status} cannot be processed.`;

      if (!isBusOwner) throw "You dont have permission to accept this fare.";

      const fares = await fareRepository.completeFareById(value.fareId);
      const messenging = admin.messaging();

      await messenging.send({
        topic: fare.bus.id,
        notification: {
          title: `Fare Completed @ Rs ${fare.amount}`,
          body: `${fare.bus.busnumber}  : (${fare.departure.from.name} - ${fare.departure.to.name}, Thank you for using our service`,
        },
      });
      await messenging.send({
        topic: fare.faredBy.id,
        notification: {
          title: `Fare Completed @ Rs ${fare.amount}`,
          body: `${fare.bus.busnumber}  : (${fare.departure.from.name} - ${fare.departure.to.name}, Thank you for using our service`,
        },
      });
      return res.status(200).json(fares);
    } catch (error) {
      return res.status(400).json({ message: error });
    }
  }
);

export default fareRouter;
