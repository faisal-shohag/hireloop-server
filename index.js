const express = require("express");
const dontenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
const Stripe = require("stripe");
dontenv.config();

const uri = process.env.MONGODB_URI;

const app = express();
const PORT = process.env.PORT;

app.use(cors());
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);

const verifyToken = async (req, res, next) => {
  const authHeader = req?.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    next();
  } catch (error) {
    console.log(error);
    return res.status(403).json({ message: "Forbidden" });
  }
};

async function run() {
  try {
    // await client.connect();
    const db = client.db("hireloop2");

    const companyCollection = db.collection("companies");
    const jobCollection = db.collection("jobs");
    const paymentCollection = db.collection("payments");
    const userCollection = db.collection("user");
    const applicationCollection = db.collection("applications");
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // Recruiter apis
    app.post("/company", async (req, res) => {
      const company = req.body;
      const result = await companyCollection.insertOne(company);
      res.json(result);
    });

    app.get("/company/:userEmail", async (req, res) => {
      const { userEmail } = req.params;
      const result = await companyCollection
        .find({
          userEmail,
        })
        .toArray();
      res.json(result);
    });

    app.get("/approved-companies/:userEmail", async (req, res) => {
      const { userEmail } = req.params;
      const result = await companyCollection
        .find({ status: "approved", userEmail })
        .toArray();
      res.json(result);
    });

    //post a job
    app.post("/jobs", async (req, res) => {
      const job = req.body;
      const result = await jobCollection.insertOne({
        ...job,
        company: new ObjectId(job.company),
      });
      res.json(result);
    });

    //get jobs by user Id
    app.get("/my-jobs/:userEmail", async (req, res) => {
      const { userEmail } = req.params;
      const result = await jobCollection.find({ userEmail }).toArray();
      res.json(result);
    });

    //get all jobs using find
    app.get("/jobs", async (req, res) => {
      const { jobTitle, type = "" } = req.query;
      let query = {};
      if (jobTitle) {
        query.jobTitle = { $regex: jobTitle, $options: "i" };
      }
      //filter with type
      if (type) {
        query.jobType = type;
      }

      const result = await jobCollection.find(query).toArray();
      res.json(result);
    });

    //search jobs by title
    app.get("/jobs/search", async (req, res) => {
      const { jobTitle } = req.query;
      const result = await jobCollection
        .find({
          jobTitle: { $regex: jobTitle, $options: "i" },
        })
        .toArray();
      res.json(result);
    });

    //get 5 jobs for home page
    app.get("/jobs/homepage", async (req, res) => {
      const result = await jobCollection.find().limit(5).toArray();
      res.json(result);
    });

    //------------------------
    //get a particular job with company look up
    app.get("/jobs/:jobId", async (req, res) => {
      const { jobId } = req.params;
      const result = await jobCollection
        .aggregate([
          { $match: { _id: new ObjectId(jobId) } },
          {
            $lookup: {
              from: "companies",
              localField: "company",
              foreignField: "_id",
              as: "companyInfo",
            },
          },
        ])
        .toArray();
      res.json(result[0]);
    });

    //get approved companies
    app.get("/approved-companies", async (req, res) => {
      const { companyName } = req.query;
      const query = { status: "approved" };
      if (companyName) {
        query.companyName = { $regex: companyName, $options: "i" };
      }

      const result = await companyCollection.find(query).toArray();
      res.json(result);
    });

    //get jobs by specific company
    app.get("/jobs/company/:companyId", async (req, res) => {
      const { companyId } = req.params;
      const result = await jobCollection
        .find({
          company: new ObjectId(companyId),
        })
        .toArray();
      res.json(result);
    });

    app.post("/job/apply/:jobId", verifyToken, async (req, res) => {
      const user = req.user;
      const { jobId } = req.params;
      if (!jobId) {
        return res.status(400).json({ message: "Job ID is required" });
      }

      if (user.plan != "pro") {
        return res
          .status(403)
          .json({ message: "Upgrade to Pro plan to apply for jobs" });
      }
      const job = await jobCollection.findOne({ _id: new ObjectId(jobId) });
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      const existingApplication = await applicationCollection.findOne({
        userId: new ObjectId(user.sub),
        jobId: new ObjectId(jobId),
      });

      if (existingApplication) {
        return res
          .status(400)
          .json({ message: "You have already applied for this job" });
      }
      const result = await applicationCollection.insertOne({
        userId: new ObjectId(user.sub),
        jobId: new ObjectId(jobId),
        companyId: job.company,
        status: "pending",
        appliedAt: new Date(),
      });
      res.json(result);
    });

    // ======STRIPE============
    app.post("/create-checkout", verifyToken, async (req, res) => {
      const user = req.user;

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "Hireloop Pro Plan",
                description: "Access to all features",
              },
              unit_amount: 20 * 100, // $20.00 in cents
            },
            quantity: 1,
          },
        ],
        success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_URL}/cancel`,
        client_reference_id: user.sub,
        metadata: {
          userId: user.sub,
          email: user.email || "",
        },
      });

      res.json({ url: session.url, session: session });
    });

    app.post("/confirm-session", verifyToken, async (req, res) => {
      const { sessionId } = req.body;
      const user = req.user;

      if (!sessionId) {
        return res.status(400).json({ error: "Session ID is required" });
      }

      //check if session exists
      const existingSession = await paymentCollection.findOne({ sessionId });
      if (existingSession) {
        return res
          .status(400)
          .json({ error: "Session already confirmed and recorded" });
      }

      const session = await stripe.checkout.sessions.retrieve(sessionId);

      //check if same user is confirming
      if (session.metadata.email !== req.user.email) {
        return res
          .status(403)
          .json({ error: "Session does not belong to this user" });
      }

      //check if checkout is completed
      if (session.payment_status !== "paid" && session.status !== "complete") {
        return res
          .status(400)
          .json({ error: "Checkout is not completed yet!" });
      }

      //update database
      const result = await paymentCollection.insertOne({
        userId: session.metadata.userId,
        email: session.metadata.email,
        sessionId: session.id,
        amount: session.amount_total / 100,
        currency: session.currency,
        paymentStatus: session.payment_status,
        createdAt: new Date(),
      });

      //update user plan
      await userCollection.updateOne(
        { email: session.metadata.email },
        { $set: { plan: "pro" } },
      );

      //respond success
      res.json({
        message: "Payment confirmed and database updated successfully",
      });
    });

    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running fine!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
